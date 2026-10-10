# Candorra — Project Scaffolding

## What's in here

- `/schema/001_init.sql` — Postgres DDL (append-only ledger design)
- `/backend/` — Node.js/Express skeleton (initData validation, ledger service, withdrawal state machine)
- `/telebothost/candorra_bot_commands.txt` — TBL script for @CandorraBot (paste into TeleBotHost's editor — syntax not live-verified, see warning in the file)
- `/miniapp/index.html` — deployable Mini App shell, mock data, ready to get you a live URL today

## Fastest path to unblock AdsGram + BotFather registration

You need a live HTTPS URL before either of those can proceed. This is the quickest route:

1. Create a free GitHub repo, push the contents of `/miniapp/` to it (just `index.html`).
2. Go to render.com → sign up → **New +** → **Static Site** → connect that repo.
3. Build command: leave blank. Publish directory: `.` (a single dot).
4. Click **Create Static Site**. Render gives you a URL like `https://candorra-miniapp.onrender.com` — this is a genuinely free tier with no cold-start issue, since static sites aren't a running server process.
5. Use that URL in two places:
   - **BotFather:** `/mybots` → @CandorraBot → **Bot Settings** → **Menu Button** (or `/newapp`) → paste the URL
   - **AdsGram Partner portal:** paste the same URL wherever it asks for your Mini App's Web App URL

This gets you unblocked in both places within about 10–15 minutes, without needing the backend or database live yet.

## What still needs you before it does anything real

- New (revoked/reissued) bot token → goes into your hosting provider's environment variables when we deploy the backend, never into a file or chat
- Supabase (or your chosen provider) database connection string → same, environment variable only
- AdsGram App/Block ID + API key, once you're registered on the Partner side
- TON payout wallet — later, not yet


## v2 update (27 Sep 2026)
- `miniapp/index.html` is now the v2 design (5 tabs, daily check-in on Home). The v1 file is kept in `archive/`.
- All reward numbers come from the `CONFIG` block at the top of the script in `index.html`. Change `assumedEcpmUsd` only to a MEASURED value.
- Backend fix: the placeholder gross payout per view was $0.04 (eCPM $40, roughly 40x the documented AdsGram range). It is now $0.001 (eCPM $1.00).
- To publish v2: replace `index.html` in your GitHub repo with the new file; Render redeploys automatically.

## Vault update (28 Sep 2026)
- `schema/001_init.sql` now has `pending_rewards`. Run the whole file on a fresh database.
- `webhooks.js` parks each reward in the Vault; `releaseDueRewards()` (runs every 60 s inside `server.js`) moves due rewards into the ledger.
- New endpoints: `GET /api/balance`, `GET /api/vault` (both need Telegram initData).
- NOT tested against a real Postgres yet. Test the schema and the release function first (Supabase SQL editor).
- Hardening TODO before real money: every ledger write (credit, withdrawal debit) must run in one transaction that locks the user row. `releaseDueRewards` does; `withdrawals.js` does not yet.


## Architecture change (29 Sep 2026): TeleBotHost removed
The bot layer now lives in `backend/src/routes/telegram.js` (plain Node.js, tested with a mock
- see the project conversation log). TeleBotHost is no longer part of the architecture.
After deploying the backend to Render, set the webhook once:
`curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://YOUR-RENDER-URL/webhooks/telegram"`
`telebothost/candorra_bot_commands.txt` is now obsolete - kept in `archive/` for reference only.

## Architecture change (29 Sep 2026): TeleBotHost removed
The bot layer now lives in `backend/src/routes/telegram.js` (plain Node.js, tested with a mock -
see the project conversation log). TeleBotHost is no longer part of the architecture. After
deploying the backend to Render, set the webhook once:
`curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://YOUR-RENDER-URL/webhooks/telegram"`
`archive/candorra_bot_commands.txt` is the obsolete TeleBotHost script, kept for reference only.
