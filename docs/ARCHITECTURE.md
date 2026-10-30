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
Android app ◄── FCM push (needs the server service account; Android never polls)
web app     ──► GET /api/notifications/pending ──► browser notification
both        ──► GET /api/signals/:id            ──► full details
```

| Layer | File |
| --- | --- |
| HTTP router / controllers | `server/index.ts` |
| Signal service + repository | `server/core/signals.ts` |
| Distribution, eligibility, worker, transport | `server/core/distribution.ts` |
| Auth, hashed sessions (expiry + 3-per-user cap), admin sessions, PARTNER expiry job | `server/core/auth.ts` |
| Schema, migrations, settings, seed | `server/core/schema.ts` |
| Helpers (JSON, hashing, rate limit, client IP, routing) | `server/core/util.ts` |
| Database handle (platform-managed) | `server/lib/db.ts` |
| React client | `src/` |
| Admin panel | `src/pages/Admin.tsx` (secret route `VITE_ADMIN_PATH`; not bundled without it) |
| Play-build flag | `src/lib/flags.ts` (`IS_PLAY_BUILD`) |

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
| `TRUST_PROXY_HOPS` | behind a proxy | `0` | Reverse proxies in front of Node. `0` ignores `X-Forwarded-For` (forgeable); set `1` behind one proxy so rate limits see real client IPs. |

Full list (SMTP, `APP_URL`, build-time `VITE_*`, signing): `docs/HANDOFF.md` §5.

---

## 3. Database

Migrations run at startup from `SCHEMA_SQL` in `server/core/schema.ts`
(idempotent `CREATE TABLE IF NOT EXISTS`). The file lives in `server/data/app.db`,
the only directory that survives a redeploy.

Tables: `users`, `auth_sessions`, `admin_sessions`, `password_resets`, `devices`,
`signals`, `signal_edits`, `delivery_jobs`, `settings`.

Indexes: `signals(external_signal_id)`, `signals(symbol)`,
`signals(signal_timestamp DESC)`, `signals(status, closed_at DESC)`,
`delivery_jobs(status, next_attempt_at)`, `delivery_jobs(device_id, status, created_at DESC)`,
`auth_sessions(user_id, created_at DESC)`.

Idempotency: `signals.external_signal_id` is UNIQUE and
`delivery_jobs(signal_id, device_id, revision, kind)` is UNIQUE — a repeated save creates
neither a second row nor a second push, while NEW / UPDATE / DELETE notices for
the same signal can coexist.

Sessions: both session tables store only `sha256(token)`. User sessions expire
after 30 days without use; admin sessions after 12 hours. The minute cron purges
expired sessions and reset tokens.

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
project's environment settings. Traffic is served over HTTPS by the platform, so
also set `TRUST_PROXY_HOPS=1`.

The Google Play app is built with `npm run build:play` (see `docs/DEPLOYMENT.md`).

Before going live: sign in to the admin panel → **Signals** → *Delete sample data*, and
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

- **Rate limits** (in-memory, per client IP from `clientIp()`):
  - Per minute: login 15, signup 10, admin login 10.
  - Failed logins only (15-min window): 10 per email, 30 per IP; admin 5 per IP, each failure logged.
  - Forgot-password: 3 per email per hour, 20 per IP per 15 min. Reset-password: 10 per IP per 15 min.
  - `X-Forwarded-For` is ignored unless `TRUST_PROXY_HOPS` is set, so clients can't fake their IP.
- **Sessions**: random 256-bit tokens, stored as `sha256` only. Users: 30-day
  sliding expiry, max 3 per account (oldest signed out). Admin: 12h. Password
  reset signs out every session. The admin UI returns to its login form on a 401.
- Strict payload validation and a 256 KB body cap.
- Passwords hashed with scrypt + per-user salt, compared in constant time.
- Every admin route passes through one `requireAdmin` guard — hiding the UI is
  never the protection.
- Parameterised SQL everywhere; no string interpolation of user input.
- HTTPS is terminated by the platform. The Android release build allows HTTPS
  only and trusts system CAs only (`network_security_config.xml`). WebView
  debugging is off, and `allowBackup` is false.
- The Play build ships no admin code and no Partner / Telegram calls to action.

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
| Sessions | oldest session signed out past the 3-session cap · newest stays valid · logout revokes the token |
| Admin | unauthenticated 401 · wrong credentials 401 · login · list users · grant Partner with duration · downgrade · read logs |
| Queue | notification queued for the device · payload carries `type=TRADING_SIGNAL` + `signalId` · ack removes it |

Manual checks worth running once: set `member_visible_count` to 1, publish two
signals, and confirm the second is blurred and its push is generic; grant a user
7 days of Partner and confirm the profile countdown; wait for a `partnerEndAt` to pass
and confirm the minute-interval job downgrades the account.

Rate limits are deliberately **not** in the suite: tripping them would lock the
test machine's IP out of later runs. Check them by hand against a dev server,
then restart it to clear the counters. Leave ~1 minute between back-to-back
suite runs.
