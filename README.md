# SignalDesk — Crypto & Forex Trading Signals

A mobile-first trading-signal app (crypto + forex) with a TradingView → backend → push
pipeline, a Member/Partner access model, a closed-signal history, a position-size calculator and a
staff management panel.

> **SignalDesk is not a broker.** It never executes trades. Signals are guidance only, not
> financial advice, and trading involves substantial risk.

---

## 1. Contents

1. [Feature overview](#2-feature-overview)
2. [Tech stack](#3-tech-stack)
3. [Folder structure](#4-folder-structure)
4. [Running it locally (demo)](#5-running-it-locally-demo)
5. [Environment variables](#6-environment-variables)
6. [Database & migrations](#7-database--migrations)
7. [Key flows](#8-key-flows)
8. [Roles & permissions](#9-roles--permissions)
9. [API reference](#10-api-reference)
10. [TradingView webhook setup](#11-tradingview-webhook-setup)
11. [Admin panel](#12-admin-panel)
12. [Testing](#13-testing)
13. [Production deployment](#14-production-deployment)
14. [Troubleshooting](#15-troubleshooting)

---

## 2. Feature overview

**App (end users)**

| Screen | What it does |
| --- | --- |
| First run | Risk disclaimer acknowledgement + timezone selection (defaults to the device timezone) |
| Signals | Live feed, newest first. Members see the first N open signals of the day in full, the rest blurred/locked |
| Signal details | Entry, stop loss, **all take-profit levels**, timing in the user's timezone, change history |
| History | Closed signals from the last 14 days, with result and P/L, paginated |
| Calculator | Position-size / risk calculator for crypto (units) and forex (lots) |
| Settings | Timezone, notification preferences, full disclaimer |
| Contact | Telegram / Website / Instagram / e-mail — also the route to becoming a Partner |
| Account | Email + password sign-up/sign-in, Partner status and remaining time |

**Backend**

* TradingView webhook → validation → persistence → async fan-out → push.
* Idempotent ingestion (a replayed alert never creates a second row or a second push).
* Per-device delivery queue with retries and exponential backoff.
* Members see the first N open signals of the day in full; Partners see every signal in real time.
* **Editable published signals**: every edit is logged, the app shows an “Edited” badge, and
  everyone who already received the signal gets an update notice.
* Partner access with an expiry job that returns users to Member automatically.

**Not implemented on purpose:** in-app payments. Partner access happens by contacting the team;
staff flip the tier in the admin panel.

---

## 3. Tech stack

| Layer | Choice |
| --- | --- |
| App | React 19 + TypeScript + Vite 6 + Tailwind CSS v4 + React Router 7 |
| Icons | lucide-react |
| Backend | Node.js `node:http` (no framework), TypeScript, run with `tsx` |
| Database | SQLite via `node:sqlite` (synchronous, WAL mode) |
| Push | Pull-based device queue; FCM HTTP v1 transport when a service account is configured |

---

## 4. Folder structure

```
.
├── index.html                 App shell (RTL-safe, viewport meta, Vazirmatn font)
├── package.json
├── vite.config.ts             React + Tailwind v4 plugins
├── README.md                  This document
├── docs/
│   └── ARCHITECTURE.md        Deeper notes on the delivery pipeline
├── server/
│   ├── index.ts               HTTP entry point — every /api route lives here
│   ├── lib/
│   │   └── db.ts              Platform-managed SQLite handle (do not edit)
│   ├── core/
│   │   ├── schema.ts          Schema, migrations, settings, sample data
│   │   ├── auth.ts            Users, sessions, admin tokens, Partner expiry
│   │   ├── signals.ts         Ingestion, editing + change log, read/redaction
│   │   ├── distribution.ts    Eligibility, queue, worker, transport
│   │   └── util.ts            JSON/HTTP helpers, hashing, rate limiting
│   ├── tests/
│   │   └── api.test.ts        End-to-end API test suite
│   └── data/                  SQLite file (created at runtime, persistent)
└── src/
    ├── App.tsx                Routes + notification deep-link handling
    ├── index.css              Tailwind entry + app-level utilities
    ├── components/
    │   ├── Layout.tsx         Header, bottom navigation, toast notifications
    │   ├── SignalCard.tsx     Feed card, locked card, “Edited” badge
    │   ├── TimezonePicker.tsx
    │   └── ui.tsx             Panel, Badge, Button, empty/error/skeleton states
    ├── lib/
    │   ├── api.ts             fetch wrapper (`/api/...`; absolute only in the native shell)
    │   ├── store.tsx          App state: timezone, prefs, session, toasts
    │   ├── push.ts            Web notification permission + queue polling
    │   ├── nativePush.ts      Capacitor/FCM bridge (native builds only)
    │   ├── firebaseStub.ts    Dead-code stub so the browser bundle skips the Firebase SDK
    │   ├── storage.ts         localStorage keys and device token
    │   ├── time.ts            Timezone-aware formatting
    │   ├── types.ts           Shared TypeScript types
    │   └── useSignals.ts      Paginated signal loading
    └── pages/
        ├── Onboarding.tsx  Feed.tsx  SignalDetails.tsx  History.tsx
        ├── Calculator.tsx  Settings.tsx  Contact.tsx  Profile.tsx
        └── Admin.tsx       Staff panel (own route + login)
```

---

## 5. Running it locally (demo)

The API and the app are two separate processes. Everything below assumes the **default API port
3001**; if you run the API somewhere else, move the proxy with it (see 5.1).

### 5.1 Web demo

```bash
npm install          # once

# terminal 1 — API on :3001
npm run server

# terminal 2 — app on :5173
npm run dev
```

Open **http://localhost:5173**.

Vite forwards every `/api/...` call to `http://localhost:3001` (`server.proxy` in
`vite.config.ts`), which is why the app can use relative paths everywhere. To run against an API
on a different port:

```bash
API_PROXY_TARGET=http://localhost:3099 npm run dev
```

The first visit shows the risk disclaimer and timezone picker; after that you land on the signal
feed. All data lives in `server/data/app.db`, so anything you publish or edit survives a
restart.

### 5.2 Admin dashboard

Open **http://localhost:5173/admin** — it is a route inside the same app, not a second server.
Sign in with:

| Field | Default |
| --- | --- |
| Username | `admin` |
| Password | `Kx7-Panel-Trade-92` |

There is also a discreet **“Staff access”** link in the desktop footer (hidden on mobile).

Those are the defaults, hashed into the database on **first boot** from `ADMIN_USERNAME` /
`ADMIN_PASSWORD`. Changing the variables afterwards has no effect — see §6.

### 5.3 Android demo

The native app is a Capacitor wrapper around the same web build. The one thing it needs that the
web build doesn't is the **API's absolute origin**, baked in at build time: the WebView's origin
is `https://localhost`, so a relative `/api` call has nothing to resolve against.

```bash
# 1. build the web assets with the API origin baked in
VITE_API_BASE_URL=http://10.0.2.2:3001 npm run build

# 2. copy them into the native project
npx cap sync android

# 3. build and install the debug APK
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
  ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug
$HOME/Library/Android/sdk/platform-tools/adb install -r \
  app/build/outputs/apk/debug/app-debug.apk
```

Which origin the device should use:

| Target | `VITE_API_BASE_URL` | Why |
| --- | --- | --- |
| Emulator | `http://10.0.2.2:3001` | `10.0.2.2` is the emulator's alias for the host loopback |
| Phone over USB | `http://localhost:3001` | pair it with `adb reverse tcp:3001 tcp:3001` to tunnel the port |
| Phone over Wi-Fi | `http://<your-lan-ip>:3001` | phone and Mac on the same network |

(`JAVA_HOME` assumes Homebrew's `openjdk@21`; Capacitor 8 refuses to build on Java 17.)

Cleartext `http://` is already allowed: `android.allowMixedContent` is set in
`capacitor.config.ts` and a debug-only `android/app/src/debug/AndroidManifest.xml` enables
`usesCleartextTraffic`. Release builds stay HTTPS-only.

Notifications with the app **closed** additionally need Firebase: `google-services.json` in
`android/app/`, plus a service account on the server (`GOOGLE_APPLICATION_CREDENTIALS`, §6).
Without the service account nothing is lost — the device simply drains the queue from
`/api/notifications/pending` while it is running.

### 5.4 Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server for the app |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built app locally |
| `npm run server` | Start the API (`server/index.ts` via tsx) |
| `npm run test:api` | Run the API test suite against a running server |

---

## 6. Environment variables

All of these are read by the **backend** only. None are required to boot — every one has a
safe default — but the first two must be set before going live.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TRADINGVIEW_WEBHOOK_SECRET` | `change-me-tradingview-secret` | Shared secret TradingView must send. Compared in constant time. |
| `ADMIN_PASSWORD` | `Kx7-Panel-Trade-92` | Admin password, hashed into the database on first boot. |
| `ADMIN_USERNAME` | `admin` | Admin username, stored on first boot. |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to the Firebase service-account JSON. When set, notifications are pushed through FCM HTTP v1 so they arrive with the app closed. Without it the app pulls its queue while running. |
| `PORT` | `3001` | Port the API listens on (assigned by the host in production). |

Changing `ADMIN_PASSWORD` after the first boot has no effect — the credentials are already
in the `settings` table. Delete the `admin_password_hash` row (or the database) to re-seed.

Runtime settings that do **not** need a redeploy live in the admin panel’s Settings tab:
unlocked signal count, history window, contact links, support e-mail.

---

## 7. Database & migrations

SQLite lives at `server/data/app.db` (the only directory that survives a redeploy). WAL mode
and a busy timeout are enabled, and foreign keys are on.

`initDatabase()` in `server/core/schema.ts` runs on every boot and is idempotent:

1. `migrate(SCHEMA_SQL)` — `CREATE TABLE IF NOT EXISTS` for every table and index.
2. Additive column migrations for databases created by an older build:
   `signals.take_profits`, `signals.edited_at`, `signals.edit_count`.
3. `delivery_jobs` rebuild — the original table had `UNIQUE(signal_id, device_id)`, which made
   a second delivery for the same signal impossible. It is recreated with
   `UNIQUE(signal_id, device_id, revision)` plus `kind`, and existing rows are copied over as
   `kind = 'NEW', revision = 0`.
4. `take_profits` backfill from the legacy single `take_profit` column.
5. Default settings, admin credentials, and sample signals **only when the table is empty**.

### Tables

| Table | Purpose |
| --- | --- |
| `users` | email, password hash, plan, `partner_start_at`/`partner_end_at`, suspended, timezone |
| `sessions` | bearer tokens for signed-in users |
| `admin_tokens` | bearer tokens for the staff panel |
| `devices` | one row per install: push token, owner, notification preferences |
| `signals` | the signal itself, including `take_profits` (JSON array), `close_price`, `edited_at`, `edit_count` |
| `signal_edits` | change log: one row per changed field per revision (old → new) |
| `delivery_jobs` | per-device delivery queue: `kind`, `revision`, status, attempts, backoff |
| `webhook_events` | webhook audit trail: accepted / duplicate / invalid / rate limited |
| `settings` | runtime configuration and admin credentials |

**Take profits.** `take_profits` stores a JSON array (`[67000,69000,71000]`), ordered TP1 → TPn.
`take_profit` is kept as the first level for backward compatibility; both are written together.

**Close price.** `close_price` is populated **only when a signal closes** — by the panel’s
Close action, by a TradingView `CLOSE` alert, or by hand in the edit dialog. For open signals
the admin table shows `—`. Closing also computes `pnl_percent` (direction-aware) and a result
of `TP`/`SL`/`MANUAL`.

---

## 8. Key flows

### 8.1 Signal lifecycle

```
TradingView alert
   │  POST /api/webhooks/tradingview   (secret + JSON)
   ▼
rate limit → validate → deterministic external id → dedupe
   │
   ├── duplicate → 200 { duplicate: true }, nothing else happens
   ▼
INSERT INTO signals                      (persist BEFORE distributing)
   │
   ├── respond 202 immediately
   ▼
setImmediate → enqueueSignalDistribution(signalId)
   │   one delivery_job per device, PENDING or SKIPPED + reason
   ▼
worker (every 3s) → transportSend → SENT → device pulls / FCM delivers
   ▼
device acknowledges → DELIVERED
   ▼
CLOSE alert or admin action → status CLOSED, close_price, result, P/L
   ▼
appears in History for 14 days
```

### 8.2 Editing a published signal

```
Admin panel → Signals → Edit
   │  PATCH /api/admin/signals/:id { …fields, notify: true }
   ▼
updateSignal() compares every field it was given
   ├── nothing different → 200, no log row, no notification
   ▼
UPDATE signals … , edited_at = now, edit_count = revision
INSERT INTO signal_edits (one row per changed field, with old → new)
   │
   ├── respond 200 { signal, changes, revision, notified }
   ▼
setImmediate → enqueueSignalDistribution(id, { kind: 'UPDATE', revision })
   │   audience = devices that already received THIS signal (SENT/DELIVERED)
   │   the Member daily limit does not apply — a correction always goes out
   ▼
notification: "Updated: BUY BTCUSDT" / "Entry price: 65000 → 65500 · …"
   ▼
app shows an “Edited” badge on the card and in details,
plus a full change history (field, old → new, revision, timestamp)
```

Reopening a closed signal (status → OPEN) clears `closed_at`, `close_price`, `result` and
`pnl_percent`, so a re-opened signal can never display a stale outcome.

### 8.3 Notification eligibility

A delivery job is created for every enabled device; whether it is `PENDING` or `SKIPPED`
is decided by `evaluateEligibility()` and the reason is stored for the logs:

| Check | Skip reason |
| --- | --- |
| Device disabled (invalid token) | `device_disabled` |
| Notifications turned off | `notifications_off` |
| User suspended | `user_suspended` |
| Partner active (`plan = PARTNER`, not suspended, `partner_end_at` in the future) | sent — `partner_active` |
| Member (no push cap) | sent — `member_quota` |
| Any edit notice for a signal the device already has | sent — `signal_updated` |

Retries: up to 5 attempts with exponential backoff (5s, 10s, 20s, 40s, 80s). An `NotRegistered`
/ `InvalidRegistration` response disables that device instead of retrying. One device failing
never blocks the rest of the queue.

### 8.4 Timezone

The first run stores a timezone (device default, editable). Every timestamp in the app is
formatted with `Intl.DateTimeFormat` in that zone; the backend only ever stores UTC ISO
strings. Signed-in users also have their zone saved server-side.

### 8.5 Position-size calculator

Inputs: market (crypto/forex), direction, account balance, risk %, entry, stop loss, optional
take profit, plus leverage (crypto) or pip size + pip value per lot (forex).

```
risk amount   = balance × risk%
stop distance = |entry − stop|
units         = risk amount ÷ stop distance          (crypto)
lots          = risk amount ÷ (pips at risk × pip value per lot)   (forex)
notional      = units × entry
margin        = notional ÷ leverage
reward/risk   = |target − entry| ÷ stop distance
```

It warns about a stop on the wrong side of the entry, a risk above 5%, and a margin larger
than the balance. Spread, commission, funding and slippage are explicitly excluded.

---

## 9. Roles & permissions

| Role | Auth | Can |
| --- | --- | --- |
| Guest / Member | none (device token only) | Browse the feed with the first N open signals of the day unlocked, read closed history, use the calculator, set timezone |
| Partner | email + password, tier granted by staff | Everything above with **all** signals unlocked and real-time pushes while `partner_end_at` is in the future |
| Suspended | — | Treated as ineligible for all notifications |
| Admin | username + password → bearer token | Users and Partner durations, suspend, create/edit/close/delete signals, delivery + webhook logs, runtime settings |

Enforcement is server-side. Locked signals are **redacted before serialisation** — a Member
client never receives the symbol, action or prices of a locked signal, and
`GET /api/signals/:id` answers `403 partner_required` for it. Every `/api/admin/*` route calls the
same `requireAdmin()` guard.

---

## 10. API reference

### Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | Liveness probe |
| GET | `/api/config` | Contact links, access limits, performance stats |
| GET | `/api/signals?status=open\|closed\|all&market=&page=&pageSize=` | Paginated, newest first, redacted per tier |
| GET | `/api/signals/:id` | Full signal + `changes[]`; `403` when locked |
| POST | `/api/devices/push-token` | Register/refresh a device and its preferences |
| DELETE | `/api/devices/push-token/:id` | Unregister (own device only) |
| GET | `/api/notifications/pending` | Device queue drain (`x-device-token`) |
| POST | `/api/notifications/ack` | Mark jobs delivered |
| POST | `/api/auth/signup` · `/api/auth/login` · `/api/auth/logout` | Email + password |
| GET | `/api/auth/me` | Current user + device push usage |
| PATCH | `/api/auth/timezone` | Persist the chosen timezone |

### Webhook

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/webhooks/tradingview` | Secret in `x-webhook-secret` or `secret` in the body. 60 req/min per IP. `202` accepted, `200` duplicate, `401` bad secret, `422` invalid payload |

### Admin (all require `x-admin-token`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/admin/login` · `/api/admin/logout` | Returns / revokes a bearer token |
| GET | `/api/admin/overview` | Counters, performance, edited-signal count |
| GET | `/api/admin/users?q=` | Search by email |
| POST | `/api/admin/users/:id/plan` | `{ plan: 'PARTNER', days: 30 }` or `{ plan: 'MEMBER' }` |
| POST | `/api/admin/users/:id/suspend` | `{ suspended: true\|false }` |
| GET | `/api/admin/signals?page=` | All signals, unredacted |
| POST | `/api/admin/signals` | Publish manually — same pipeline as a webhook |
| **PATCH** | **`/api/admin/signals/:id`** | **Edit a published signal** |
| GET | `/api/admin/signals/:id/changes` | Full change log |
| POST | `/api/admin/signals/:id/close` | `{ closePrice, result }` |
| DELETE | `/api/admin/signals/:id` | Remove a signal |
| DELETE | `/api/admin/sample-signals` | Remove the shipped demo rows |
| GET | `/api/admin/logs` | Latest 100 deliveries + 50 webhook events |
| GET/POST | `/api/admin/settings` | Runtime settings |

`PATCH /api/admin/signals/:id` accepts any subset of:

```jsonc
{
  "symbol": "BTCUSDT",
  "action": "BUY",                       // BUY | SELL | CLOSE
  "price": 65500,
  "stopLoss": 63500,
  "takeProfits": [67000, 69000, 71000],  // replaces every level, in order
  "timeframe": "1h",
  "strategy": "Breakout v2",
  "note": "Entry adjusted after the retest",
  "status": "OPEN",                      // OPEN | CLOSED
  "closePrice": 67000,                   // only meaningful when CLOSED
  "result": "TP",
  "notify": true                         // default true
}
```

Response: `{ signal, changes[], revision, notified }`.

---

## 11. TradingView webhook setup

1. Set `TRADINGVIEW_WEBHOOK_SECRET` on the server and restart it.
2. In TradingView open your alert → **Notifications** → tick **Webhook URL**:
   `https://YOUR-DOMAIN/api/webhooks/tradingview`
3. Put this in the alert **Message** box:

```json
{
  "secret": "YOUR_WEBHOOK_SECRET",
  "id": "{{strategy.order.id}}-{{timenow}}",
  "strategy": "Breakout v2",
  "symbol": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "price": {{close}},
  "stopLoss": 63500,
  "takeProfits": [67000, 69000, 71000],
  "timeframe": "{{interval}}",
  "time": "{{timenow}}"
}
```

Notes:

* `action` must be `BUY`, `SELL` or `CLOSE` (case-insensitive).
* Take profits accept three shapes: `takeProfits: [ ... ]`, `tp1` / `tp2` / `tp3` …, or a single
  `takeProfit`. Duplicates are removed, order is preserved, max 8 levels.
* `id` should be stable for one logical alert — that is what makes replays idempotent. If you
  omit it, a deterministic id is derived from strategy + symbol + action + timeframe + time + price.
* Alternative to `secret` in the body: send the header `x-webhook-secret`.
* A `CLOSE` alert closes the newest matching open signal for that symbol and records the
  close price, the result and the P/L.

Verify with curl:

```bash
curl -X POST https://YOUR-DOMAIN/api/webhooks/tradingview \
  -H 'Content-Type: application/json' \
  -d '{"secret":"YOUR_WEBHOOK_SECRET","id":"manual-1","symbol":"BTCUSDT","action":"BUY","price":65000,"takeProfits":[66000,67000]}'
```

Then check **Admin → Delivery logs → Webhook events**.

---

## 12. Admin panel

**Locally:** <http://localhost:5173/admin> — sign in as `admin` / `Kx7-Panel-Trade-92` (§5.2).
**Deployed:** `https://YOUR-DOMAIN/admin`. Either way there is a discreet “Staff access” link in
the desktop footer (hidden on mobile). Change the credentials via the `ADMIN_USERNAME` /
`ADMIN_PASSWORD` variables **before the first boot**, or ask for a rotation.

| Tab | Contents |
| --- | --- |
| Overview | Users, active Partner, devices, signals, push sent/failed, edited signals, win rate, webhook-secret warning |
| Users | Search, grant Partner for 7/30/90/180/365 days, revert to Member, suspend |
| Signals | Publish manually (with a **+ Add take profit** repeater), table with Entry, **Take profits**, **Close price**, Status, Edit / Close / Delete, and a “Delete sample data” button |
| Delivery logs | Latest 100 deliveries (with NEW / UPDATE type and skip reason) and 50 webhook events |
| Settings | Unlocked signal count, history window, Telegram/Website/Instagram/e-mail |

**Editing a published signal:** Signals → **Edit**. Change any field, add or remove take-profit
levels (with reorder arrows), optionally untick “Notify everyone who already received this
signal”, and save. The dialog shows the full change history underneath.

---

## 13. Testing

Start both processes first (§5.1).

### 13.1 Manual walkthrough

1. **First run** — accept the risk disclaimer, pick a timezone.
2. **Signals** — newest first. As a Member the first N open signals of the day are readable; the rest are blurred.
3. **Locked card** — tapping one says “Partner required” instead of showing details.
4. **History** — closed signals from the last 14 days, with result and P/L.
5. **Calculator** — balance, risk %, entry, stop → units (crypto) or lots (forex).
6. **Settings** — change the timezone, toggle notification preferences.
7. **Account** — sign up, then in Admin → Users grant Partner for 30 days; every signal unlocks.
8. **Edit flow** — Admin → Signals → Edit, change a price and save: the card gains an “Edited”
   badge and the detail page a full change history.

### 13.2 Push notification test

Publish a signal exactly the way TradingView will (§11) and confirm the push arrives.

```bash
# background or close the app first
curl -X POST http://localhost:3001/api/webhooks/tradingview \
  -H 'Content-Type: application/json' \
  -H 'x-webhook-secret: change-me-tradingview-secret' \
  -d '{"id":"demo-1","symbol":"BTCUSDT","action":"BUY","price":65000,"takeProfits":[66000,67000]}'
```

Expect `202 {"ok":true,"duplicate":false,...}` and, seconds later, a system notification; tapping
it opens that signal. **Replay the same `id`** and you get `200 {"duplicate":true}` with **no
second notification** — that is the idempotency guarantee.

Members get a push for every signal, but once they've passed the daily
`member_visible_count` limit the push is a generic "New signal released" alert with no
symbol/price. Partners get the full text. Every skip reason is visible in
**Admin → Delivery logs**.

### 13.3 Automated API suite

```bash
npm run server        # terminal 1
npm run test:api      # terminal 2
```

Override the target and secret when testing a deployed instance:

```bash
TEST_BASE_URL=https://YOUR-DOMAIN TRADINGVIEW_WEBHOOK_SECRET=... npm run test:api
```

Coverage:

* device registration and de-duplication of push tokens
* valid webhook, invalid secret, missing action, unsupported action
* idempotency (a replayed alert returns the same signal id and creates nothing)
* multiple take profits via `takeProfits: []` and via `tp1`/`tp2`
* member vs partner: locked items in the list, `403` on a locked detail, open history
* auth: weak password, duplicate email, wrong password, new accounts start as Member
* admin: unauthenticated rejection, bad credentials, granting/revoking Partner
* the notification queue: delivery, `type` + `signalId` payload, acknowledgement
* editing a published signal: auth required, invalid action rejected, 404 for a missing id,
  take-profit replacement, revision bump, change log, no-op edits, the UPDATE notification
  reaching devices that already had the signal, and close-price recording

**Expected result: `48 passed, 0 failed`.**

The suite runs against a live server and **writes real rows**, so point it at a disposable
database — not production. To protect a database you care about, move `server/data/app.db`,
`app.db-wal` **and** `app.db-shm` aside first (the WAL holds the recent writes), run the suite
against the fresh database, then move all three back.

---

## 14. Production deployment

1. **Build the app:** `npm run build` → `dist/`.
2. **Run the API:** `npm run server` with `PORT`, `TRADINGVIEW_WEBHOOK_SECRET`,
   `ADMIN_USERNAME`, `ADMIN_PASSWORD` and optionally `GOOGLE_APPLICATION_CREDENTIALS` set.
3. **Serve both behind one HTTPS origin** so the app can keep calling relative `/api/...`
   paths. The webhook must be reachable over HTTPS for TradingView.
4. **Persist `server/data/`** — it holds the SQLite database.
5. **First-run checklist:**
   * sign in to `/admin`, delete the sample signals;
   * set the Telegram / Website / Instagram links and the support e-mail;
   * confirm the Overview tab no longer warns about the webhook secret;
   * fire one test alert from TradingView and watch it land in the logs.

**Android app.** The client is wrapped with Capacitor (`android/`) and packaged from the same
web build. Notifications while the app is fully closed require a Firebase service account
(`GOOGLE_APPLICATION_CREDENTIALS`); without it the queue is drained whenever the app is running
and nothing is lost — the items simply wait.

---

## 15. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Webhook returns `401` | Secret mismatch. Compare `TRADINGVIEW_WEBHOOK_SECRET` with the alert message (never logged — check the value, not the log). |
| Webhook returns `422` | `symbol` or `action` missing, or an action other than BUY/SELL/CLOSE. |
| Alert accepted but no notification | Check Delivery logs — the skip reason says why (`notifications_off`, `device_disabled`, …). |
| Notifications only arrive with the app open | No Firebase service account is configured (`GOOGLE_APPLICATION_CREDENTIALS` unset). That is the expected fallback behaviour. |
| An edit sent no notification | Nothing actually changed, `notify` was unticked, or no device had received the original signal yet (SENT/DELIVERED). |
| Admin password change ignored | Credentials are seeded once. Remove the `admin_password_hash` setting row and restart. |
| Sample signals visible in production | Admin → Signals → **Delete sample data**. |
| `ExperimentalWarning: SQLite is an experimental feature` | Normal Node output. Not an error. |
| Browser feed is blank / errors immediately | The API isn't running, or Vite is proxying to the wrong port. Check `npm run server` is up and that `API_PROXY_TARGET` matches its `PORT`. |
| Android app shows a blank screen | Built without `VITE_API_BASE_URL`, so `/api` hits the WebView's own asset server and returns `index.html`. Rebuild per §5.3. |
| Android push never arrives; logcat shows `Firebase Installations Service is unavailable` | The emulator can't resolve hostnames (it does **not** inherit the Mac's resolver). Boot it with a working DNS server: `emulator -avd <name> -dns-server <your-dns>`. |
| Android push never arrives and logcat is clean | No service account on the server, so `transportSend` silently no-ops (see §6). The app still gets the signal by polling while it runs. |

---

*Test line for PR workflow verification (remove after test).*
