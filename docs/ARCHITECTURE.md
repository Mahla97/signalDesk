# SignalDesk — architecture & operations

Crypto + forex trading-signal delivery app. TradingView alerts arrive by webhook,
are stored, then fanned out to devices asynchronously. The app itself is a
mobile-first React client that also ships as an Android APK.

**SignalDesk is not a broker.** It executes no trades. Signals are guidance only.

---

## 1. Architecture summary

```
TradingView alert
      │  POST /api/webhooks/tradingview   (secret + JSON, rate limited)
      ▼
webhook controller  ──► signal service ──► repository (SQLite)
      │                    (validate, dedupe, persist)
      │  202 Accepted returned immediately
      ▼  setImmediate
distribution service ──► delivery_jobs (one row per eligible device)
      ▼
background worker (every 3s) ──► transport ──► device
      │  retry with exponential backoff, disables invalid tokens
      ▼
mobile app  ──► GET /api/notifications/pending ──► system notification
            ──► GET /api/signals/:id            ──► full details
```

| Layer | File |
| --- | --- |
| HTTP router / controllers | `server/index.ts` |
| Signal service + repository | `server/core/signals.ts` |
| Distribution, eligibility, worker, transport | `server/core/distribution.ts` |
| Auth, sessions, admin tokens, PRO expiry job | `server/core/auth.ts` |
| Schema, settings, seed | `server/core/schema.ts` |
| Helpers (JSON, hashing, rate limit, routing) | `server/core/util.ts` |
| Database handle (platform-managed) | `server/lib/db.ts` |
| React client | `src/` |
| Admin panel | `src/pages/Admin.tsx` (route `/admin`) |

**Stack**: Node (built-in `http` + `node:sqlite`) · React 19 + Vite 6 +
Tailwind v4 · SQLite (WAL) · no external services required.

**Extensibility**: to add a Telegram channel later, add a transport function in
`distribution.ts` and enqueue a second job kind. The webhook controller and the
signal service do not change.

---

## 2. Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `3001` | Assigned automatically in production. |
| `TRADINGVIEW_WEBHOOK_SECRET` | **yes in production** | `change-me-tradingview-secret` | Shared secret checked with a constant-time compare. |
| `ADMIN_USERNAME` | no | `admin` | Only read on the very first boot. |
| `ADMIN_PASSWORD` | no | `Kx7-Panel-Trade-92` | Only read on the very first boot; stored hashed. |
| `GOOGLE_APPLICATION_CREDENTIALS` | no | — | Path to the Firebase service-account JSON. When set, deliveries are pushed via FCM HTTP v1; otherwise they are queued for the device to pull. |

Secrets are never logged. The webhook logs record the outcome and the caller,
never the token itself.

---

## 3. Database

Migrations run at startup from `SCHEMA_SQL` in `server/core/schema.ts`
(idempotent `CREATE TABLE IF NOT EXISTS`). The file lives in `server/data/app.db`,
the only directory that survives a redeploy.

Tables: `users`, `sessions`, `admin_tokens`, `devices`, `signals`,
`delivery_jobs`, `webhook_events`, `settings`.

Indexes: `signals(external_signal_id)`, `signals(symbol)`,
`signals(signal_timestamp DESC)`, `signals(status, closed_at DESC)`,
`delivery_jobs(status, next_attempt_at)`, `delivery_jobs(device_id, status, created_at DESC)`.

Idempotency: `signals.external_signal_id` is UNIQUE and
`delivery_jobs(signal_id, device_id)` is UNIQUE — a replayed alert creates
neither a second row nor a second push.

---

## 4. Setup

### Local
```bash
npm install
npm run server     # API on :3001
npm run dev        # web client
```

### Production
The platform builds the client with `vite build` and runs `server/index.ts`
with `tsx`, injecting `PORT`. Set `TRADINGVIEW_WEBHOOK_SECRET` (and
`ADMIN_PASSWORD` before the first boot) in the project's environment settings.
Traffic is served over HTTPS by the platform.

Before going live: sign in to `/admin` → **Signals** → *Delete sample data*, and
set the real Telegram / website / Instagram links under **Settings**.

---

## 5. TradingView webhook configuration

1. TradingView → create an alert → **Notifications** tab → tick *Webhook URL*.
2. URL: `https://<your-domain>/api/webhooks/tradingview`
   (only ports 80/443 are accepted by TradingView).
3. Alert message — must be valid JSON so TradingView sends `application/json`:

```json
{
  "secret": "YOUR_TRADINGVIEW_WEBHOOK_SECRET",
  "id": "{{strategy.order.id}}-{{timenow}}",
  "strategy": "Momentum Breakout",
  "symbol": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "price": {{close}},
  "stopLoss": 0,
  "takeProfit": 0,
  "timeframe": "{{interval}}",
  "time": "{{timenow}}"
}
```

The secret may instead be sent as the header `x-webhook-secret`.

- `action` accepts `BUY`, `SELL`, `CLOSE` (case-insensitive).
- `id` is optional: without it a deterministic id is derived from
  strategy + symbol + action + timeframe + time + price.
- A `CLOSE` alert closes the newest open signal on that symbol, records the
  close price, computes P/L % and marks the result `TP`/`SL`.
- Use **Once Per Bar Close** to avoid duplicate firings (duplicates are ignored
  anyway).

Responses: `202` accepted · `200 {duplicate:true}` replay · `401` bad secret ·
`422` invalid payload · `429` rate limited (60/min per IP).

---

## 6. Plans, eligibility and limits

A push is queued for a device only when **all** hold:
plan is PRO with `proEndAt` in the future · not suspended · notifications
enabled · trading signals enabled · the BUY/SELL preference matches the action.
Free devices are also allowed, capped at `free_push_per_day` (default 2, UTC day).

In-app reading: free viewers see the newest `free_visible_count` open signals in
full (default 3); the rest are blurred and locked, and `GET /api/signals/:id`
returns 403 for them. **Closed history is unlocked for everyone** for
`history_days` days (default 14). All three values are editable in the admin panel.

---

## 7. API reference

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/webhooks/tradingview` | webhook secret |
| GET | `/api/config` | public |
| GET | `/api/signals?status=open\|closed\|all&page&pageSize` | optional bearer |
| GET | `/api/signals/:id` | optional bearer (403 when locked) |
| POST | `/api/devices/push-token` | device header |
| DELETE | `/api/devices/push-token/:id` | device header |
| GET | `/api/notifications/pending` | device header |
| POST | `/api/notifications/ack` | device header |
| POST | `/api/auth/signup` · `/api/auth/login` · `/api/auth/logout` | — |
| GET | `/api/auth/me` | bearer |
| PATCH | `/api/auth/timezone` | optional bearer |
| POST | `/api/admin/login` | credentials |
| GET | `/api/admin/overview` · `/users` · `/signals` · `/logs` · `/settings` | `x-admin-token` |
| POST | `/api/admin/users/:id/plan` (`{plan, days}`) · `/users/:id/suspend` · `/signals` · `/signals/:id/close` · `/settings` | `x-admin-token` |
| DELETE | `/api/admin/signals/:id` · `/api/admin/sample-signals` | `x-admin-token` |

Client requests carry `x-device-token` (per-install id) and, when signed in,
`Authorization: Bearer <session>`.

---

## 8. Security

- Constant-time secret comparison; the secret is never written to a log.
- Rate limits: webhook 60/min per IP, login 15/min, signup 10/min, admin 10/min.
- Strict payload validation and a 256 KB body cap.
- Passwords hashed with scrypt + per-user salt.
- Every admin route passes through one `requireAdmin` guard — hiding the UI is
  never the protection.
- Parameterised SQL everywhere; no string interpolation of user input.
- HTTPS is terminated by the platform.

---

## 9. Test plan

```bash
npm run server        # shell 1
npm run test:api      # shell 2
```

`server/tests/api.test.ts` covers:

| Area | Cases |
| --- | --- |
| Webhook | valid alert accepted · invalid secret rejected · missing action rejected · unsupported action rejected · replay deduped to the same id |
| Devices | registration · re-registration does not duplicate |
| Free vs Pro | anonymous treated as free · locked items present · locked detail returns 403 · Pro sees everything unlocked · Pro can open any detail |
| History | closed signals never locked |
| Auth | weak password rejected · signup · duplicate email rejected · wrong password rejected · new user starts FREE |
| Admin | unauthenticated 401 · wrong credentials 401 · login · list users · grant PRO with duration · downgrade · read logs |
| Queue | notification queued for the device · payload carries `type=TRADING_SIGNAL` + `signalId` · ack removes it |

Manual checks worth running once: set the free daily cap to 1 in the admin
panel, publish two signals, and confirm the second is logged as
`SKIPPED / free_daily_limit`; grant a user 7 days of Pro and confirm the profile
countdown; wait for a `proEndAt` to pass and confirm the minute-interval job
downgrades the account.
