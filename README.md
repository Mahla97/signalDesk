# SignalDesk — Crypto & Forex Trading Signals

A mobile-first trading-signal app (crypto + forex) with a TradingView → backend → push
pipeline, a Free/Pro access model, a closed-signal history, a position-size calculator and a
staff management panel.

> **SignalDesk is not a broker.** It never executes trades. Signals are guidance only, not
> financial advice, and trading involves substantial risk.

---

## 1. Contents

1. [Feature overview](#2-feature-overview)
2. [Tech stack](#3-tech-stack)
3. [Folder structure](#4-folder-structure)
4. [Local setup](#5-local-setup)
5. [Environment variables](#6-environment-variables)
6. [Database & migrations](#7-database--migrations)
7. [Key flows](#8-key-flows)
8. [Roles & permissions](#9-roles--permissions)
9. [API reference](#10-api-reference)
10. [TradingView webhook setup](#11-tradingview-webhook-setup)
11. [Admin panel](#12-admin-panel)
12. [Tests](#13-tests)
13. [Production deployment](#14-production-deployment)
14. [Troubleshooting](#15-troubleshooting)

---

## 2. Feature overview

**App (end users)**

| Screen | What it does |
| --- | --- |
| First run | Risk disclaimer acknowledgement + timezone selection (defaults to the device timezone) |
| Signals | Live feed, newest first. Free users see the newest N in full, the rest blurred/locked |
| Signal details | Entry, stop loss, **all take-profit levels**, timing in the user's timezone, change history |
| History | Closed signals from the last 14 days, with result and P/L, paginated |
| Calculator | Position-size / risk calculator for crypto (units) and forex (lots) |
| Settings | Timezone, notification preferences, full disclaimer |
| Contact | Telegram / Website / Instagram / e-mail — also the route to becoming Pro |
| Account | Email + password sign-up/sign-in, Pro status and remaining time |

**Backend**

* TradingView webhook → validation → persistence → async fan-out → push.
* Idempotent ingestion (a replayed alert never creates a second row or a second push).
* Per-device delivery queue with retries and exponential backoff.
* Free plan: max 2 push notifications per day (configurable). Pro: everything, in real time.
* **Editable published signals**: every edit is logged, the app shows an “Edited” badge, and
  everyone who already received the signal gets an update notice.
* Pro subscriptions with an expiry job that returns users to Free automatically.

**Not implemented on purpose:** in-app payments. Upgrading happens by contacting the team;
staff flip the plan in the admin panel.

---

## 3. Tech stack

| Layer | Choice |
| --- | --- |
| App | React 19 + TypeScript + Vite 6 + Tailwind CSS v4 + React Router 7 |
| Icons | lucide-react |
| Backend | Node.js `node:http` (no framework), TypeScript, run with `tsx` |
| Database | SQLite via `node:sqlite` (synchronous, WAL mode) |
| Push | Pull-based device queue; optional FCM transport when `FCM_SERVER_KEY` is set |

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
│   │   ├── auth.ts            Users, sessions, admin tokens, Pro expiry
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
    │   ├── api.ts             fetch wrapper (always relative `/api/...`)
    │   ├── store.tsx          App state: timezone, prefs, session, toasts
    │   ├── push.ts            Notification permission + queue polling
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

## 5. Local setup

```bash
npm install

# terminal 1 — API on :3001
npm run server

# terminal 2 — app on :5173 (proxies /api to :3001)
npm run dev
```

Scripts:

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
| `FCM_SERVER_KEY` | — | When set, notifications are pushed through FCM so they arrive with the app closed. Without it the app pulls its queue while running. |
| `PORT` | `3001` | Port the API listens on (assigned by the host in production). |

Changing `ADMIN_PASSWORD` after the first boot has no effect — the credentials are already
in the `settings` table. Delete the `admin_password_hash` row (or the database) to re-seed.

Runtime settings that do **not** need a redeploy live in the admin panel’s Settings tab:
free push per day, unlocked signal count, history window, contact links, support e-mail.

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
| `users` | email, password hash, plan, `pro_start_at`/`pro_end_at`, suspended, timezone |
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
   │   the free daily limit does not apply — a correction always goes out
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
| Trading signals turned off | `trading_signals_off` |
| BUY/SELL preference off | `buy_pref_off` / `sell_pref_off` |
| User suspended | `user_suspended` |
| Pro active (`plan = PRO`, not suspended, `pro_end_at` in the future) | sent — `pro_active` |
| Free, under the daily cap | sent — `free_quota` |
| Free, cap reached | `free_daily_limit` |
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
| Guest / Free | none (device token only) | Browse the feed with the newest N signals unlocked, read closed history, use the calculator, set timezone, receive up to 2 pushes per day |
| Pro | email + password, plan granted by staff | Everything above with **all** signals unlocked and unlimited real-time pushes while `pro_end_at` is in the future |
| Suspended | — | Treated as ineligible for all notifications |
| Admin | username + password → bearer token | Users and Pro durations, suspend, create/edit/close/delete signals, delivery + webhook logs, runtime settings |

Enforcement is server-side. Locked signals are **redacted before serialisation** — a free
client never receives the symbol, action or prices of a locked signal, and
`GET /api/signals/:id` answers `403 pro_required` for it. Every `/api/admin/*` route calls the
same `requireAdmin()` guard.

---

## 10. API reference

### Public

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | Liveness probe |
| GET | `/api/config` | Contact links, free limits, performance stats |
| GET | `/api/signals?status=open\|closed\|all&market=&page=&pageSize=` | Paginated, newest first, redacted per plan |
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
| POST | `/api/admin/users/:id/plan` | `{ plan: 'PRO', days: 30 }` or `{ plan: 'FREE' }` |
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

Open `https://YOUR-DOMAIN/admin` (there is only a discreet “Staff access” link in the desktop
footer). Default credentials: `admin` / `Kx7-Panel-Trade-92` — change them via the
`ADMIN_USERNAME` / `ADMIN_PASSWORD` variables **before the first boot**, or ask for a rotation.

| Tab | Contents |
| --- | --- |
| Overview | Users, active Pro, devices, signals, push sent/failed, edited signals, win rate, webhook-secret warning |
| Users | Search, grant Pro for 7/30/90/180/365 days, revert to Free, suspend |
| Signals | Publish manually (with a **+ Add take profit** repeater), table with Entry, **Take profits**, **Close price**, Status, Edit / Close / Delete, and a “Delete sample data” button |
| Delivery logs | Latest 100 deliveries (with NEW / UPDATE type and skip reason) and 50 webhook events |
| Settings | Free push per day, unlocked signal count, history window, Telegram/Website/Instagram/e-mail |

**Editing a published signal:** Signals → **Edit**. Change any field, add or remove take-profit
levels (with reorder arrows), optionally untick “Notify everyone who already received this
signal”, and save. The dialog shows the full change history underneath.

---

## 13. Tests

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
* free vs pro: locked items in the list, `403` on a locked detail, open history
* auth: weak password, duplicate email, wrong password, new accounts start on Free
* admin: unauthenticated rejection, bad credentials, granting/revoking Pro
* the notification queue: delivery, `type` + `signalId` payload, acknowledgement
* editing a published signal: auth required, invalid action rejected, 404 for a missing id,
  take-profit replacement, revision bump, change log, no-op edits, the UPDATE notification
  reaching devices that already had the signal, and close-price recording

The suite runs against a live server and writes real rows, so point it at a disposable
database — not production.

---

## 14. Production deployment

1. **Build the app:** `npm run build` → `dist/`.
2. **Run the API:** `npm run server` with `PORT`, `TRADINGVIEW_WEBHOOK_SECRET`,
   `ADMIN_USERNAME`, `ADMIN_PASSWORD` and optionally `FCM_SERVER_KEY` set.
3. **Serve both behind one HTTPS origin** so the app can keep calling relative `/api/...`
   paths. The webhook must be reachable over HTTPS for TradingView.
4. **Persist `server/data/`** — it holds the SQLite database.
5. **First-run checklist:**
   * sign in to `/admin`, delete the sample signals;
   * set the Telegram / Website / Instagram links and the support e-mail;
   * confirm the Overview tab no longer warns about the webhook secret;
   * fire one test alert from TradingView and watch it land in the logs.

**Android APK.** The app is packaged from the same build. Notifications while the app is fully
closed require `FCM_SERVER_KEY`; without it the queue is drained whenever the app is running
and nothing is lost — the items simply wait.

---

## 15. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Webhook returns `401` | Secret mismatch. Compare `TRADINGVIEW_WEBHOOK_SECRET` with the alert message (never logged — check the value, not the log). |
| Webhook returns `422` | `symbol` or `action` missing, or an action other than BUY/SELL/CLOSE. |
| Alert accepted but no notification | Check Delivery logs — the skip reason says why (`free_daily_limit`, `notifications_off`, `sell_pref_off`, …). |
| Notifications only arrive with the app open | `FCM_SERVER_KEY` is not set. That is the expected fallback behaviour. |
| An edit sent no notification | Nothing actually changed, `notify` was unticked, or no device had received the original signal yet (SENT/DELIVERED). |
| Admin password change ignored | Credentials are seeded once. Remove the `admin_password_hash` setting row and restart. |
| Sample signals visible in production | Admin → Signals → **Delete sample data**. |
| `ExperimentalWarning: SQLite is an experimental feature` | Normal Node output. Not an error. |

---

*Test line for PR workflow verification (remove after test).*
