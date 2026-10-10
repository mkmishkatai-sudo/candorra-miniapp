-- Candorra — initial schema
-- Ledger-based accounting: balances are NEVER stored/updated directly.
-- Every credit/debit is an immutable row in ledger_entries.

CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    telegram_id     BIGINT UNIQUE NOT NULL,
    username        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    risk_tier       TEXT NOT NULL DEFAULT 'low'
                        CHECK (risk_tier IN ('low','medium','high','critical')),
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','restricted','banned')),
    device_flag     TEXT, -- app-generated DeviceStorage identifier (weak signal, resettable)
    language_code   TEXT  -- from Telegram initData; a weak geo hint only. Telegram gives no country.
);

CREATE TABLE ad_network_events (
    id                  BIGSERIAL PRIMARY KEY,
    network_name        TEXT NOT NULL,
    external_event_id   TEXT NOT NULL,        -- id the network sent us, for idempotency
    user_id             BIGINT NOT NULL REFERENCES users(id),
    gross_payout        NUMERIC(18,6) NOT NULL,
    verified_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_payload         JSONB NOT NULL,
    UNIQUE (network_name, external_event_id)   -- hard idempotency guarantee at the DB level
);

CREATE TABLE withdrawals (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(id),
    amount              NUMERIC(18,6) NOT NULL CHECK (amount > 0),
    status              TEXT NOT NULL DEFAULT 'requested'
                            CHECK (status IN ('requested','under_review','approved','sent','failed','rejected')),
    ton_wallet_address  TEXT NOT NULL,
    tx_hash             TEXT,                 -- NULL until actually sent on-chain. Never fabricate this.
    reviewed_by         BIGINT REFERENCES users(id),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ
);

-- Append-only. No UPDATE should ever target the `amount` of an existing row.
CREATE TABLE ledger_entries (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    amount          NUMERIC(18,6) NOT NULL,   -- positive = credit, negative = debit
    type            TEXT NOT NULL
                        CHECK (type IN ('reward_credit','withdrawal_debit','admin_adjustment')),
    source_table    TEXT,                     -- 'ad_network_events' | 'withdrawals' | NULL for admin
    source_id       BIGINT,                   -- FK-by-convention into source_table, nullable
    balance_after   NUMERIC(18,6) NOT NULL,   -- denormalized snapshot for fast reads
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata        JSONB
);
CREATE INDEX idx_ledger_user_created ON ledger_entries (user_id, created_at DESC);

CREATE TABLE tasks (
    id                  BIGSERIAL PRIMARY KEY,
    network_name        TEXT NOT NULL,
    type                TEXT NOT NULL CHECK (type IN ('rewarded_video','offerwall','cpa')),
    geo_eligibility     TEXT[],               -- ISO country codes, NULL = all geos
    active              BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE referrals (
    id                          BIGSERIAL PRIMARY KEY,
    referrer_id                 BIGINT NOT NULL REFERENCES users(id),
    referred_id                 BIGINT NOT NULL REFERENCES users(id) UNIQUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    referred_activity_verified  BOOLEAN NOT NULL DEFAULT false  -- reward only fires once true
);

CREATE TABLE fraud_signals (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    signal_type     TEXT NOT NULL CHECK (signal_type IN
                        ('velocity','referral_cluster','device_flag','payout_reuse')),
    weight          NUMERIC(5,2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Non-negotiable audit trail for every admin action (Section 24, prior reports).
CREATE TABLE admin_actions (
    id              BIGSERIAL PRIMARY KEY,
    admin_id        BIGINT NOT NULL REFERENCES users(id),
    action_type     TEXT NOT NULL,
    target_table    TEXT NOT NULL,
    target_id       BIGINT NOT NULL,
    before_value    JSONB,
    after_value     JSONB,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vault: a reward waits here while the ad network's invalid-traffic checks finish,
-- then a job moves it into the append-only ledger (reward_credit). Nothing here counts
-- toward the available balance until it is released.
CREATE TABLE pending_rewards (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    amount          NUMERIC(18,6) NOT NULL CHECK (amount > 0),
    ad_event_id     BIGINT NOT NULL UNIQUE REFERENCES ad_network_events(id),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','released','voided')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    release_at      TIMESTAMPTZ NOT NULL,
    resolved_at     TIMESTAMPTZ
);
CREATE INDEX idx_pending_due ON pending_rewards (release_at) WHERE status = 'pending';

-- One-time, owner-funded bonuses (e.g. channel subscribe). NOT ad-revenue-backed, so kept
-- separate from ad_network_events. UNIQUE guarantees a user can claim each bonus type once ever.
CREATE TABLE one_time_bonuses (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    bonus_type      TEXT NOT NULL,
    amount          NUMERIC(18,6) NOT NULL,
    claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, bonus_type)
);

-- Cosmetic-only badges tied to REAL ledger events. No monetary value, so no fraud incentive.
CREATE TABLE achievements (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    badge           TEXT NOT NULL,
    earned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, badge)
);

-- "Candorra Plus" (Stars subscription) — SCHEMA ONLY. Not wired to a purchase flow yet.
-- See README for why: Stars payments are confirmed via Bot API updates (pre_checkout_query,
-- successful_payment), which arrive at the BOT layer (TeleBotHost), not this HTTP backend,
-- so TeleBotHost would need to call an internal endpoint here on successful payment.
-- Whether TBL can handle those update types is UNVERIFIED — check TeleBotHost docs/support
-- before building the purchase flow itself.
CREATE TABLE subscriptions (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    plan            TEXT NOT NULL DEFAULT 'plus',
    status          TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','active','expired','cancelled')),
    stars_paid      INTEGER,
    started_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ
);
