# SignalDesk — Developer Hand-off

Everything a new developer needs to work on SignalDesk. This is the authoritative,
up-to-date guide. `README.md` and `docs/ARCHITECTURE.md` are older and may drift —
trust this file first.

**SignalDesk is not a broker.** It never executes trades. Signals are guidance only.

---

## 1. What it is

A mobile-first crypto + forex trading-signal app with this pipeline:

```
admin publishes a signal  →  SQLite  →  per-device delivery queue  →  FCM push
                                                                    ↘  (web) device polls the queue
```

- End users see a live feed, a position-size calculator, and closed-signal history.
- A Member/Partner model gates how many signals are readable and how many pushes go out.
- Staff manage everything from an admin panel at a secret path (`VITE_ADMIN_PATH`); no link to it in the app.

## 2. Stack

| Layer | Choice |
| --- | --- |
| App | React 19 + TypeScript + Vite 6 + Tailwind CSS v4 + React Router 7 |
| Icons | lucide-react |
| Backend | Node.js built-in `node:http` (no framework) + `node:sqlite`, run with `tsx` |
| Database | SQLite (WAL mode, synchronous) |
| Push | Pull-based device queue + FCM HTTP v1 when a service account is set |
| Android | Capacitor 8 wrapper around the same web build |

No ORM, no Express, no external services required to run.

## 3. Running it locally

Requires Node 22.5+ (the backend uses `node:sqlite`) and, for Android, JDK 21.

```bash
npm install          # once

# terminal 1 — API on :3001
npm run server

# terminal 2 — web app on :5173 (proxies /api to :3001)
npm run dev
```

Open **http://localhost:5173**. Admin panel: **http://localhost:5173<VITE_ADMIN_PATH>** (set in `.env.development.local`)
(dev seed login `admin` / `Kx7-Panel-Trade-92`; rotate with `npm run admin:credentials` — see §5).

All data lives in `server/data/app.db` (gitignored). Anything you publish/edit
survives a restart.

### Android (emulator or device)

```bash
VITE_API_BASE_URL=http://10.0.2.2:3001 npm run build   # bake in the API origin
CAPACITOR_ALLOW_MIXED_CONTENT=true npx cap sync android  # allow http:// backend for debug
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:assembleDebug
$HOME/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
```

| Target | `VITE_API_BASE_URL` |
| --- | --- |
| Emulator | `http://10.0.2.2:3001` (host loopback alias) |
| Phone over USB | `http://localhost:3001` + `adb reverse tcp:3001 tcp:3001` |
| Phone over Wi-Fi | `http://<your-lan-ip>:3001` |

The native shell's WebView origin is `https://localhost`, so a relative `/api`
call has nothing to resolve against — that's why the origin must be baked in.
Cleartext `http://` is allowed in debug only: `CAPACITOR_ALLOW_MIXED_CONTENT`
(`capacitor.config.ts`) plus `android/app/src/debug/res/xml/network_security_config.xml`,
which overrides the strict release config in `src/main/res/xml/`. The release
config forbids cleartext and trusts only system CAs.

WebView remote debugging (`chrome://inspect`) is **off in every build** unless you
run `CAPACITOR_WEB_DEBUG=true npx cap sync android` for a debug session.

### Google Play build

```bash
VITE_API_BASE_URL=https://<backend> npm run build:play   # vite build + cap sync android
```

`VITE_STORE_BUILD=play` (`src/lib/flags.ts` → `IS_PLAY_BUILD`) removes every
"Join Our Team" / "How to become a Partner" call to action **and the Telegram
link** (Partner access is sold on Telegram), because Play's
Payments policy forbids steering users to an outside payment for in-app content.
Partners just sign in. `vite.config.ts` aborts a Play build if `VITE_ADMIN_PATH`
is set or the API URL isn't `https://`. Builds without `VITE_ADMIN_PATH` contain
no Admin code at all (the lazy chunk is dropped). Signing: see `docs/DEPLOYMENT.md` §4.

Admin-controlled content still reaches the Play app: the **announcement banner**
and the **Website / Instagram links**. Keep them free of prices, "become a
Partner", and Telegram links (checklist: `docs/DEPLOYMENT.md` §6.5). The
`t.me` default in `store.tsx` stays in the bundle but is never rendered.

## 4. Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run build:play` | Google Play build (`VITE_STORE_BUILD=play`) + `cap sync android` |
| `npm run preview` | Serve the built app |
| `npm run server` | Start the API (`server/index.ts` via tsx) |
| `npm run test:api` | Full API suite (64 checks) against a live server |
| `npm run test:admin` | Admin add/edit/delete lifecycle suite (14 checks) |
| `npm run admin:credentials` | Rotate admin username/password (`ADMIN_USERNAME`/`ADMIN_PASSWORD` env) and revoke all admin sessions |

Tests run against a **live server** and write real rows — use a disposable DB.
Export the admin creds first (`set -a; . ~/.config/signaldesk/admin-credentials.txt; set +a`).
Wait ~1 minute between back-to-back `test:api` runs: one run nearly uses the
per-IP signup (10/min) and login (15/min) budgets. Rate-limit counters are
in-memory, so restarting the server clears them.

## 5. Environment variables

All backend-side. Every one has a safe default; none are required to boot in
development. In **production** (`NODE_ENV=production`) the server refuses to
start on the guessable default, so `ADMIN_PASSWORD` becomes mandatory.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | — | Set to `production` for a release deploy; enables the guards below. |
| `ADMIN_USERNAME` | `admin` | Only read on first boot. |
| `ADMIN_PASSWORD` | `Kx7-Panel-Trade-92` | Only read on first boot, stored hashed. **Must be set in production.** |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to the Firebase service-account JSON → enables FCM push. |
| `FCM_SERVICE_ACCOUNT_JSON` | — | Alternative: the service-account JSON **inline** (no file). |
| `PORT` | `3001` | API port. |
| `TRUST_PROXY_HOPS` | `0` | How many reverse proxies sit in front of Node. `0` = ignore `X-Forwarded-For` (client-forgeable). Set `1` behind a single Caddy/nginx/PaaS router, or every user shares the proxy's rate-limit bucket. |
| `APP_URL` | `http://localhost:5173` | Public origin used to build password-reset links. |
| `SMTP_HOST` | — | SMTP host for password-reset email. When unset, the reset link is logged instead of emailed. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_SECURE` | `false` | `true` for TLS (port 465). |
| `SMTP_USER` | — | SMTP username. |
| `SMTP_PASS` | — | SMTP password. |
| `SMTP_FROM` | `SMTP_USER` | From address for reset emails. |

Client-side (build-time):

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Absolute API origin for the native build (`import.meta.env.VITE_API_BASE_URL`). |
| `VITE_ADMIN_PATH` | Secret admin route (e.g. `/ops-<random>`). Unset = no admin route and no Admin code in the bundle (Android build). Dev value lives in gitignored `.env.development.local`. |
| `VITE_STORE_BUILD` | `play` = Google Play build: hides Partner calls to action and the Telegram link. Set by `npm run build:play`. |
| `API_PROXY_TARGET` | Dev-only: where Vite proxies `/api` (default `http://localhost:3001`). |
| `CAPACITOR_ALLOW_MIXED_CONTENT` | `true` before `cap sync` for a debug build against an `http://` backend. Never for release. |
| `CAPACITOR_WEB_DEBUG` | `true` before `cap sync` to allow `chrome://inspect`. Never for release. |
| `SIGNING_STORE_FILE` · `SIGNING_STORE_PASSWORD` · `SIGNING_KEY_ALIAS` · `SIGNING_KEY_PASSWORD` | Gradle upload-key signing. Unset = unsigned release build. |

Changing `ADMIN_PASSWORD` after first boot has no effect — the hash is already
in the `settings` table. Rotate with `npm run admin:credentials` (or delete the `admin_password_hash` row / the DB to re-seed).

## 6. Firebase — two separate halves

Firebase push has a **client half** and a **server half**; both must be present.

1. **Client (receive).** `android/app/google-services.json` (not secret, ships in
   the APK) + `@capacitor-firebase/messaging`. Lets the app register with FCM and
   obtain a registration token. The token is stored on the `devices` row
   (`push_token`) and rotates.
2. **Server (send).** A **service-account** JSON (a private key — **never commit**)
   exposed via `GOOGLE_APPLICATION_CREDENTIALS` or `FCM_SERVICE_ACCOUNT_JSON`. The
   server signs a JWT, exchanges it for an OAuth token, and posts to
   `https://fcm.googleapis.com/v1/projects/<project>/messages:send`.

The dev service account lives at `~/.config/signaldesk/firebase-service-account.json`
(outside the repo). Without it, `transportSend` no-ops: jobs are marked `SENT` but
nothing is pushed. The web app still gets signals by polling
`/notifications/pending`; **Android does not poll** — see §11 for the caveat.

## 7. Folder structure

```
server/
  index.ts            every /api route (single HTTP router)
  lib/db.ts           SQLite handle — PLATFORM-MANAGED, do not edit
  core/
    schema.ts         tables, migrations, settings, sample data
    auth.ts           users, hashed sessions (expiry + cap), admin sessions, Partner expiry job
    signals.ts        ingestion, edit + change log, soft-delete, redaction
    distribution.ts   eligibility, queue, worker, FCM transport
    util.ts           JSON/HTTP helpers, hashing, rate limiting
    email.ts          password-reset email (SMTP, optional)
  tests/
    api.test.ts       full API suite
    admin-signals.test.ts   add/edit/delete lifecycle suite
  data/               SQLite file (created at runtime, persistent)
src/
  App.tsx            routes + notification deep-link
  components/        Layout, SignalCard, TimezonePicker, ui
  lib/               api, store (app state), push, nativePush, useSignals, time, types, …
  pages/             Onboarding, Feed, SignalDetails, History, Calculator, Settings,
                     Contact, Profile, ResetPassword, Admin
android/             Capacitor wrapper
docs/                docs (this file, ARCHITECTURE, firebase keys)
```

## 8. Database

`initDatabase()` in `server/core/schema.ts` runs on every boot, idempotently:

1. `CREATE TABLE IF NOT EXISTS` for all tables/indexes.
2. Additive column migrations (e.g. `signals.deleted_at`).
3. `delivery_jobs` rebuilds when its shape/unique-key changes.

Tables: `users`, `auth_sessions`, `admin_sessions`, `password_resets`, `devices`,
`signals`, `signal_edits`, `delivery_jobs`, `settings`.

Key facts:

- **Sessions store only `sha256(token)`**, never the raw token, so a leaked DB
  holds no usable logins. User sessions: 30-day sliding expiry (`expires_at`
  pushed forward at most hourly), max **3 per user** (oldest signed out —
  `MAX_SESSIONS_PER_USER` in `auth.ts`). Admin sessions: fixed 12h. The
  once-a-minute cron purges expired sessions and reset tokens. The legacy
  `sessions` table was migrated (hashed, users stay signed in) and
  `admin_tokens` dropped (admins re-login).
- `signals.deleted_at` — soft delete. Deleting a signal sets this instead of
  removing the row, so a **DELETE notification** can still be fanned out.
- `signals.take_profits` — JSON array of levels (TP1 → TPn); `take_profit` is
  kept as the first level for backward compatibility.
- `delivery_jobs` unique key is `UNIQUE(signal_id, device_id, revision, kind)`
  — kind is in the key so a signal's `NEW`, `UPDATE` and `DELETE` deliveries can
  coexist (all use revision 0 for NEW/DELETE).
- `signal_edits` — change log: one row per changed field per revision.

## 9. Signal lifecycle & delivery kinds

A delivery job has a `kind`:

| kind | When | Audience |
| --- | --- | --- |
| `NEW` | signal created (admin) | every eligible device |
| `UPDATE` | signal edited | devices that already received it (SENT/DELIVERED) |
| `DELETE` | signal deleted | devices that already received it |

Admin can also save a signal as a **draft** (`status = DRAFT`): it is not
distributed and hidden from users until published
(`POST /api/admin/signals/:id/publish`). The admin UI has Publish / Save-as-draft
buttons, a Publish action on draft rows, and confirmation dialogs on delete.

Flow: the admin route persists the signal **first**, responds, then
`setImmediate → enqueueSignalDistribution()` creates one `delivery_jobs` row per
eligible device. A background worker (every 3s) sends each via
`transportSend()` — FCM when configured, otherwise marks `SENT` for the device
to pull. Eligibility is decided by `evaluateEligibility()` and the skip reason
is stored.

`free_visible_count` (default 3) is the only access gate for Members: a Member
sees the **first N open signals of the current day** in full; newer ones are
blurred/locked. Members still get a push for every new signal, but when a signal
is outside their visible window the push is a generic "New signal released"
alert with no symbol/price. Partners always get the full text.
`UPDATE` and `DELETE` notices always carry full text (the device already holds
the signal).

## 10. Instant feed refresh

The feed does **not** wait for a manual reload:

- `useSignals` polls every 30s as a safety net.
- When a push/poll delivers any notification, `store.tsx` bumps `signalTick`,
  and `useSignals` re-fetches page 1 immediately. This is what makes add/edit/delete
  appear on the device without user interaction.

## 11. Known issues / caveats

- **Android does not poll `/notifications/pending`.** Native relies entirely on
  FCM. Without a server service account, Android gets nothing while the app runs
  (the feed still refreshes via its 30s poll of `/api/signals`).
- **Emulator FCM needs working DNS.** If pushes never arrive and logcat shows
  `Firebase Installations Service is unavailable`, boot the emulator with
  `-dns-server <your-dns>`.
- **Race on immediate edit.** If a signal is edited within ~2–3s of creation
  (before the worker finishes fanning out `NEW` jobs), the `UPDATE` audience
  (SENT/DELIVERED) may miss devices whose `NEW` job is still `PENDING`. Rare in
  practice; the automated test waits, so it is unaffected.
- **Member visibility.** A Member test device only reads the first
  `free_visible_count` signals of the day; newer ones blur (and their push is
  generic). Grant Partner to remove the limit while testing.

## 12. Not implemented (on purpose)

- **Partner access.** Activating Partner status is manual: users pay on Telegram, staff flip the tier in the admin panel. The Play build never says how to get it (Payments policy).
- **iOS wrapper.** Only Android is wrapped (Capacitor project exists, iOS not added).
- **Other channels** (Telegram, e-mail). The transport is pluggable
  (`distribution.ts`) but only FCM + device pull exist.
- **Real-time transport** (SSE/WebSocket). Delivery is push + 30s feed poll.
- **Admin edit audit UI beyond the change log** and other niceties.

## 13. Recent changes (this session)

- Removed the TradingView webhook (`POST /api/webhooks/tradingview`), its secret,
  the `webhook_events` table, and all related docs. Signals are now created only
  via the admin panel.
- FCM service account wired on the dev server (`GOOGLE_APPLICATION_CREDENTIALS`).
- Soft delete (`signals.deleted_at`) instead of hard delete.
- `DELETE` delivery kind so deleting a signal notifies devices instantly.
- `delivery_jobs` unique key now includes `kind` (schema migration).
- Feed refreshes instantly on any notification (`signalTick`).
- Member visibility is now "first N signals of the day" (not newest N).
- Removed `free_push_per_day`; `free_visible_count` is the only access gate.
- Locked signals push a generic no-detail alert for NEW/UPDATE/DELETE.
- Admin: draft/publish signals + confirmation dialogs on delete.
- Admin: close-signal uses an in-app price dialog (no `window.prompt`).
- Admin create form: validation + CRYPTO/FOREX selector; Publish/Draft disabled until valid.
- History paginates with a "Load more" button (page size 10).
- Admin signal table: pagination + filters (status, action, time range).
- New test suite `npm run test:admin` covering add/edit/delete.
- Release build: R8 minify + resource shrink enabled (`proguard-android-optimize.txt`).
- `android:allowBackup="false"` (auth/device tokens must not auto-restore).
- Removed Capacitor template tests (wrong `com.getcapacitor.myapp` package).
- `allowMixedContent` is now opt-in via `CAPACITOR_ALLOW_MIXED_CONTENT=true` (off in release).
- Production guards: server refuses to boot on the default admin password.
- Renamed the two tiers Free → Member and Pro → Partner; removed all payment/upgrade language from the UI.
- Admin: delete a user from the Users tab (`DELETE /api/admin/users/:id`).
- Forgot-password returns a `devResetUrl` in non-production so the reset flow is testable without SMTP.
- Notifications collapsed to a single master switch (removed trading/BUY/SELL sub-preferences).
- Account deletion: `DELETE /api/auth/me` + a confirmation flow in Profile.
- Password reset: `forgot-password` / `reset-password` endpoints + email link (SMTP) + a `/reset-password` screen.
- Privacy policy: added `docs/PRIVACY_POLICY.md` + a Settings → Privacy Policy link (configurable `privacy_policy_url`).
- Announcement banner: admin can write/toggle an announcement (Admin → Settings); it shows at the top of the feed and each user can dismiss it locally.
- Admin hardening: removed the "Staff access" footer link; admin route moved from `/admin` to a secret build-time `VITE_ADMIN_PATH` (absent from the Android build); `npm run admin:credentials` rotates username/password and revokes all admin sessions.
- **Release security pass (P0):**
  - Rate limits: `X-Forwarded-For` is only trusted via `TRUST_PROXY_HOPS` (it was spoofable, which bypassed every limit). Buckets no longer wipe at 5,000 keys. Failed-login budgets (successes never count): 10 per email / 30 per IP per 15 min, admin 5 per IP per 15 min (failures logged). Forgot-password: 3 per email per hour, plus 20 per IP per 15 min (was 5). Reset-password: 10 per IP per 15 min.
  - Sessions hashed + expiring + capped (see §8). Admin UI returns to its login form on a 401 (`ADMIN_SESSION_EXPIRED` event in `api.ts`).
  - Android: network security config (release: HTTPS + system CAs only; debug override allows cleartext and user CAs); removed the now-ignored debug-manifest cleartext flag; WebView debugging off unless `CAPACITOR_WEB_DEBUG=true`; explicit `debuggable false`; env-based upload-key signing.
  - Play build flag (`npm run build:play`) + Vite guard; Admin chunk excluded when there's no admin path. The Play build also hides the Telegram contact link (Partner access is sold there).
  - Docs synced: README, ARCHITECTURE (security section), DEPLOYMENT (§6.5 Payments policy, signing env vars, `TRUST_PROXY_HOPS`), PRIVACY_POLICY (session/IP wording, correct Telegram handle).
  - Dev admin credentials and admin path rotated (old ones were exposed).

## 14. Before Google Play release — checklist

Code fixes are done; these items need console/account access and are not yet done:

- **Privacy policy — host it + Data Safety form.** The policy text is written
  (`docs/PRIVACY_POLICY.md`) and the app links to it (Settings → Privacy Policy).
  Remaining: host the policy at a public URL, set that URL in the Play Console
  store listing, and fill out the Data Safety form.
- **Account-deletion web path.** In-app deletion is implemented; Play also wants a
  web URL where users can request deletion outside the app. Add that link in the
  console.
- **Financial-services policy review.** Trading-signal content may require a
  financial-services declaration/review — confirm eligibility before submit.
- **Restrict the Firebase Android API key.** `android/app/google-services.json`
  ships in the APK; lock its API key to this app's package + SHA-1 fingerprints
  (upload key and Play app-signing key) in Google Cloud Console so it cannot be
  abused elsewhere.
- **Play App Signing + upload keystore.** The signing config exists (env vars,
  `docs/DEPLOYMENT.md` §4). Remaining: create the upload keystore, enroll in
  Play App Signing, and build with `npm run build:play` → `:app:bundleRelease`.
- **Set `TRUST_PROXY_HOPS`** on the production server (usually `1`), or all
  users share one rate-limit bucket.
- **Production admin credentials.** Generate fresh ones for prod; never reuse dev values.

---

Keep this file updated whenever the code changes. It is the hand-off source of truth.
