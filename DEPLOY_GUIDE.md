# CANDORRA — চূড়ান্ত Deployment Guide
**তারিখ: ৩০ সেপ্টেম্বর ২০২৬**

এই guide অনুসরণ করলে এখন পর্যন্ত যা যা তৈরি হয়েছে (Vault, Welcome Boost, Standing, badges, channel-task, Spin, Monetag integration, Telegram bot-layer), সবকিছু বাস্তবে চালু হবে। প্রতিটা ধাপে **কী করবেন** আর **কোথায় কী বসাবেন** স্পষ্ট করে দেওয়া আছে।

**সৎভাবে বলে রাখি:** এই guide শেষ করলেও bot সম্পূর্ণ "user-ready" হবে না, কারণ তিনটা জিনিস এখনো আমাদের হাতে না — AdsGram-এর Declined সমস্যা সমাধান, Monetag-এর real SDK domain, এবং Bangladesh-এ crypto payout নিয়ে আইনি পরামর্শ। এই guide সেই তিনটা বাদে বাকি সবকিছু প্রস্তুত করে দেয়, যাতে ওগুলো resolve হওয়ামাত্র সুইচ অন করা যায়।

---

## ধাপ ১ — Supabase Database

1. **supabase.com** → Sign up → **New Project**
2. Database password দিন, **নিরাপদে সংরক্ষণ করুন** (নোটে লিখে রাখুন)
3. Project তৈরি হলে: **Settings → Database → Connection string → URI** কপি করুন — এটাই `DATABASE_URL`
4. বাম মেনু → **SQL Editor** → `schema/001_init.sql`-এর পুরো content paste করে **Run**
5. তারপর `schema/002_seed_adsgram_tasks.sql` **এখনো চালাবেন না** — এতে পুরনো, এখন invalid AdsGram Block ID লেখা আছে

---

## ধাপ ২ — GitHub repo-তে সব ফাইল আপলোড

আপনার existing repo-তে (যেখানে এখন শুধু `index.html` আছে):
1. **backend** পুরো folder আপলোড করুন (drag & drop, GitHub folder-সহ upload সমর্থন করে)
2. `index.html`-টা **replace** করুন নতুন ভার্সন দিয়ে (এই package-এর `miniapp/index.html`)
3. **Commit changes**

---

## ধাপ ৩ — Render-এ Backend (Web Service)

1. render.com → **New + → Web Service**
2. একই GitHub repo connect করুন
3. **Root Directory:** `backend`
4. **Build Command:** `npm install`
5. **Start Command:** `npm start`
6. **Create Web Service** — তৈরি হলে একটা URL পাবেন, যেমন `https://candorra-backend.onrender.com`

### Environment Variables (Render dashboard → Environment ট্যাব)

এখানে বসান — **কোনোটাই GitHub-এ বা এই চ্যাটে না**:

| Variable | Value |
|---|---|
| `BOT_TOKEN` | আপনার নতুন (revoke করার পর পাওয়া) bot token |
| `DATABASE_URL` | ধাপ ১-এ পাওয়া Supabase connection string |
| `MINIAPP_URL` | `https://candorra-miniapp.onrender.com/` |
| `ADMIN_TELEGRAM_ID` | `6534482918` |
| `OFFICIAL_CHANNEL_USERNAME` | `@CandorraOfficial` |
| `CHANNEL_SUBSCRIBE_BONUS_USD` | `0.003` |
| `WITHDRAWALS_OPEN` | `false` (আইনজীবীর মতামত না আসা পর্যন্ত বদলাবেন না) |
| `MIN_WITHDRAWAL_USD` | `5` |
| `HOLD_HOURS` | `24` |
| `FRAUD_RESERVE_PCT` | `0.08` |
| `PAYOUT_COST_PCT` | `0.02` |
| `INFRA_RESERVE_PCT` | `0.10` |
| `REWARD_POOL_PCT` | `0.45` |
| `WELCOME_BOOST_SHARE` | `0.70` |
| `WELCOME_BOOST_VIEWS` | `3` |
| `MONETAG_ZONE_ID` | `11926475` |
| `MONETAG_POSTBACK_SECRET` | নিজে একটা random string বানান (যেমন একটা লম্বা পাসওয়ার্ড), এখানে বসান |
| `ADSGRAM_CALLBACK_SECRET` | AdsGram approve হলে বসাবেন — আপাতত যেকোনো placeholder রাখুন |
| `ADSGRAM_REWARD_BLOCK_ID` | AdsGram-এর নতুন Block ID পেলে বসাবেন |
| `ADSGRAM_ESTIMATED_PAYOUT_PER_REWARD` | `0.001` |

**Deploy শেষ হলে**, সেই URL (`https://candorra-backend.onrender.com`) টা পরের ধাপে লাগবে।

---

## ধাপ ৪ — Telegram Webhook Set করা

Backend live হওয়ার পর, এই URL টা **browser-এর address bar-এ** paste করে Enter চাপুন (token আর backend-URL নিজেরটা দিয়ে বদলে):

```
https://api.telegram.org/bot<আপনার BOT_TOKEN>/setWebhook?url=https://candorra-backend.onrender.com/webhooks/telegram
```

`{"ok":true,"result":true,...}` দেখলে সফল। এরপর @CandorraBot-এ `/start` পাঠালে welcome message আসা উচিত।

---

## ধাপ ৫ — Mini App-কে real backend-এর সাথে যুক্ত করা

`miniapp/index.html` ফাইলে একটা জায়গায় (`CONFIG.apiBase: ''`) এখন খালি আছে। এটা বদলে backend-এর URL বসান:

```js
apiBase: 'https://candorra-backend.onrender.com',
```

তারপর GitHub repo-তে `index.html` আবার commit করুন — Render Static Site নিজে থেকেই redeploy করবে।

---

## ধাপ ৬ — Monetag SDK সম্পূর্ণ করা

1. Monetag dashboard → **SDK Integration / Installation** section থেকে **exact `<script src="...">` tag** কপি করুন
2. `miniapp/index.html`-এর `<head>`-এ যেখানে লেখা আছে `<script src="https://domain.com/sdk.js" ...>`, সেই `domain.com` অংশটা **আপনার real URL দিয়ে বদলান**
3. Deploy হওয়ার পর browser-এ Mini App খুলে, **Developer Tools → Network tab** খুলে একটা "Watch" বাটনে চাপুন — দেখুন Monetag-এ আসলে কী request যাচ্ছে, `ymid`/`requestVar` ঠিকভাবে পৌঁছাচ্ছে কিনা। যদি না পৌঁছায়, এই একটা function-ই (`watchMonetagAd`, `miniapp/index.html`-এ) ঠিক করতে হবে, বাকি কিছু না।
4. Monetag dashboard-এ আপনার Zone-এর **Postback URL** field-এ বসান:
   ```
   https://candorra-backend.onrender.com/webhooks/monetag/reward?secret=<MONETAG_POSTBACK_SECRET>&ymid={ymid}&zone_id={zone_id}&request_var={request_var}&event_type={event_type}&reward_event_type={reward_event_type}&estimated_price={estimated_price}
   ```
   (`<MONETAG_POSTBACK_SECRET>`-এর জায়গায় ধাপ ৩-এ যে secret বানিয়েছিলেন, সেটাই বসবে)

---

## ধাপ ৭ — AdsGram (অপেক্ষমাণ)

AdsGram-এর Declined-এর কারণ জানা গেলে ও নতুন Block ID পেলে — আমাকে জানান, তখন `schema/002_seed_adsgram_tasks.sql` আর env variable-গুলো ঠিক করে দেব।

---

## ধাপ ৮ — চূড়ান্ত end-to-end test

সব ধাপ শেষে:
1. @CandorraBot-এ `/start` → welcome message + "Open Candorra" বাটন আসা উচিত
2. Mini App খুলুন → Home-এ balance "0" দেখানো উচিত (fake না, real backend থেকে)
3. "Join @CandorraOfficial" task চাপুন → channel খুলুন, subscribe করুন, ফিরে এসে দেখুন ৩ coin যোগ হয়েছে কিনা (এটা পুরোপুরি independent, AdsGram/Monetag ছাড়াই কাজ করা উচিত)
4. Monetag SDK ঠিক থাকলে, Watch & Earn-এ একটা ad দেখুন, কিছুক্ষণ পর Vault-এ reward দেখা উচিত

কোনো ধাপে আটকালে, exact error message/screenshot পাঠান — আন্দাজ না করে সরাসরি ঠিক করে দেব।
