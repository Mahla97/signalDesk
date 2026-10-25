# SignalDesk — architecture & operations

Crypto + forex trading-signal delivery app. Staff publish signals from the admin
panel; they are stored, then fanned out to devices asynchronously. The app itself
is a mobile-first React client that also ships as an Android APK.

**SignalDesk is not a broker.** It executes no trades. Signals are guidance only.

---

## 1. Architecture summary

```
Admin publishes a signal
      │  POST /api/admin/signals   (admin token + JSON)
      ▼
signal service ──► repository (SQLite)
      │  (validate, dedupe, persist)
      │  201 Created returned immediately
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
| Auth, sessions, admin tokens, PARTNER expiry job | `server/core/auth.ts` |
| Schema, settings, seed | `server/core/schema.ts` |
| Helpers (JSON, hashing, rate limit, routing) | `server/core/util.ts` |
| Database handle (platform-managed) | `server/lib/db.ts` |
| React client | `src/` |
| Admin panel | `src/pages/Admin.tsx` (route `/admin`) |

**Stack**: Node (built-in `http` + `node:sqlite`) · React 19 + Vite 6 +
Tailwind v4 · SQLite (WAL) · no external services required.

**Extensibility**: to add a Telegram channel later, add a transport function in
`distribution.ts` and enqueue a second job kind. The signal service does not change.

---

## 2. Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `3001` | Assigned automatically in production. |
| `ADMIN_USERNAME` | no | `admin` | Only read on the very first boot. |
| `ADMIN_PASSWORD` | no | `Kx7-Panel-Trade-92` | Only read on the very first boot; stored hashed. |
| `GOOGLE_APPLICATION_CREDENTIALS` | no | — | Path to the Firebase service-account JSON. When set, deliveries are pushed via FCM HTTP v1; otherwise they are queued for the device to pull. |

---

## 3. Database

Migrations run at startup from `SCHEMA_SQL` in `server/core/schema.ts`
(idempotent `CREATE TABLE IF NOT EXISTS`). The file lives in `server/data/app.db`,
the only directory that survives a redeploy.

Tables: `users`, `sessions`, `admin_tokens`, `devices`, `signals`,
`delivery_jobs`, `settings`.

Indexes: `signals(external_signal_id)`, `signals(symbol)`,
`signals(signal_timestamp DESC)`, `signals(status, closed_at DESC)`,
`delivery_jobs(status, next_attempt_at)`, `delivery_jobs(device_id, status, created_at DESC)`.

Idempotency: `signals.external_signal_id` is UNIQUE and
`delivery_jobs(signal_id, device_id)` is UNIQUE — a repeated save creates
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
with `tsx`, injecting `PORT`. Set `ADMIN_PASSWORD` before the first boot in the
project's environment settings. Traffic is served over HTTPS by the platform.

Before going live: sign in to `/admin` → **Signals** → *Delete sample data*, and
set the real Telegram / website / Instagram links under **Settings**.

---

## 5. Tiers, eligibility and limits

A push is queued for a device only when **all** hold:
plan is PARTNER with `partnerEndAt` in the future · not suspended · notifications
enabled. Member devices are always allowed; the push text is generic when they are
past the `member_visible_count` window.

In-app reading: Members see the first `member_visible_count` open signals of
the current day in full (default 3); the rest are blurred and locked, and
`GET /api/signals/:id` returns 403 for them. **Closed history is unlocked for everyone** for
`history_days` days (default 14). All three values are editable in the admin panel.

---

## 6. API reference

| Method | Path | Auth |
| --- | --- | --- |
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

## 7. Security

- Rate limits: login 15/min, signup 10/min, admin 10/min.
- Strict payload validation and a 256 KB body cap.
- Passwords hashed with scrypt + per-user salt.
- Every admin route passes through one `requireAdmin` guard — hiding the UI is
  never the protection.
- Parameterised SQL everywhere; no string interpolation of user input.
- HTTPS is terminated by the platform.

---

## 8. Test plan

```bash
npm run server        # shell 1
npm run test:api      # shell 2
```

`server/tests/api.test.ts` covers:

| Area | Cases |
| --- | --- |
| Signal creation | valid signal accepted · missing action rejected · unsupported action rejected |
| Devices | registration · re-registration does not duplicate |
| Member vs Partner | anonymous treated as a Member · locked items present · locked detail returns 403 · Partner sees everything unlocked · Partner can open any detail |
| History | closed signals never locked |
| Auth | weak password rejected · signup · duplicate email rejected · wrong password rejected · new user starts MEMBER |
| Admin | unauthenticated 401 · wrong credentials 401 · login · list users · grant Partner with duration · downgrade · read logs |
| Queue | notification queued for the device · payload carries `type=TRADING_SIGNAL` + `signalId` · ack removes it |

Manual checks worth running once: set `member_visible_count` to 1, publish two
signals, and confirm the second is blurred and its push is generic; grant a user
7 days of Partner and confirm the profile countdown; wait for a `partnerEndAt` to pass
and confirm the minute-interval job downgrades the account.
