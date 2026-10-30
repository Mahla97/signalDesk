# SignalDesk — Deployment Guide (backend + Google Play)

Everything you need to take SignalDesk from local dev to a live app on Google
Play. This is the deployment counterpart to `HANDOFF.md` (the code guide).

---

## 1. Is it publish-ready?

**Not yet.** The app code is largely finished, but publishing needs a few things
that are *not* code: a release signing key, a hosted backend URL, a Play Console
account + listing, and a couple of policy items.

| Area | Status |
| --- | --- |
| App code (features, admin panel, push, auth) | ✅ Done |
| Release build config (R8, `allowBackup=false`, no cleartext) | ✅ Done |
| Privacy policy text | ✅ Written (`docs/PRIVACY_POLICY.md`) |
| Release signing key + Play App Signing | ❌ Not started |
| Hosted backend + HTTPS URL | ❌ Not started |
| Google Play Console account + store listing | ❌ Not started |
| Data Safety form | ❌ Not started |
| Hosted privacy-policy URL | ❌ Not started |
| Account-deletion web URL | ❌ Not started |
| Firebase API-key restriction | ❌ Not started |
| Financial-services policy review | ❌ Not started |

---

## 2. Do you need a domain?

**For the backend: yes, a public HTTPS URL.** For the two policy pages: no —
free hosted pages are fine.

- **Backend API** — the app calls `https://<your-url>/api/...`. You either buy a
  domain, or use a PaaS that gives you a URL (e.g. `*.up.railway.app`). A custom
  domain is cleaner and more professional, but not strictly required to ship.
- **Privacy policy** — Google Play requires a *public URL*. Free hosting works
  (GitHub Pages, a public Notion page, etc.).
- **Account-deletion URL** — same: a free single page is enough.
- **Password-reset links** — `APP_URL` is the base used to build reset URLs; it
  just needs to point at wherever your app/backend is reachable.

---

## 3. Backend deployment

The app needs a **backend server** running somewhere with a public HTTPS URL.
Google Play only distributes the Android APK — it does **not** run the server.

### 3.1 What you deploy

- **Backend:** `server/` (Node + SQLite). The only process that must be hosted.
- **Android app:** built separately and uploaded to Google Play. It reaches the
  backend over the network via `VITE_API_BASE_URL`.

The backend is a pure `/api` server — it does **not** serve the web frontend. If
you also want the web app at a URL, serve `dist/` separately and proxy `/api`.

### 3.2 Hard requirements

1. **Node 22.5+** — the backend uses the built-in `node:sqlite` module.
2. **Persistent disk** — `server/data/app.db` must survive restarts. Serverless
   platforms (Vercel, Netlify Functions, Cloudflare Workers) cannot run this.
3. **Environment variables** — see below.

### 3.3 Environment variables (production)

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | **yes** | Set to `production` (enables the default-password guard). |
| `ADMIN_USERNAME` | yes | Admin login (read once on first boot). |
| `ADMIN_PASSWORD` | **yes** | Server refuses to boot on the default. |
| `APP_URL` | yes | Public origin used to build password-reset links. |
| `PORT` | no | Default `3001`. |
| `TRUST_PROXY_HOPS` | **yes behind a proxy** | Number of reverse proxies in front of Node (`1` for a single Caddy/nginx/Railway router). Rate limiting uses the client IP; without this every user looks like the proxy's IP. Unset = `X-Forwarded-For` is ignored (it's client-forgeable). With Cloudflare in front of nginx, use `2`. |
| `SMTP_HOST` · `SMTP_PORT` · `SMTP_SECURE` · `SMTP_USER` · `SMTP_PASS` · `SMTP_FROM` | yes (for reset email) | `SMTP_FROM` must be a domain verified in your email provider. |
| `GOOGLE_APPLICATION_CREDENTIALS` or `FCM_SERVICE_ACCOUNT_JSON` | no (push) | Enables FCM push; without it Android gets no notifications. |

### 3.4 Hosting options

**Easiest — Railway:**

1. Push the repo to GitHub.
2. Railway → New Project → **Deploy from GitHub repo**.
3. Add a **Volume** mounted at `/app/server/data` (where the SQLite DB lives).
4. Add the environment variables above.
5. Start command: `npm run server`.

**Alternative — a VPS (DigitalOcean / Hetzner / Linode):**

```bash
git clone <your-repo-url> && cd signalMaster
nvm install 22 && nvm use 22
npm install
npm run server   # after exporting the env vars
```

Keep it running with `pm2` (or systemd) and put HTTPS in front with Caddy or nginx.

### 3.5 After the backend is up

- Build the Play app with the backend URL baked in. `build:play` hides every
  "become a Partner" prompt and the Telegram link (Play Payments policy, §6.5) and
  refuses to build if `VITE_ADMIN_PATH` is set or the URL isn't `https://`:
  ```bash
  VITE_API_BASE_URL=https://your-backend.com npm run build:play   # vite build + cap sync
  ```
- Sign in to the admin panel (secret `VITE_ADMIN_PATH`), delete the sample signals, and set the contact links.

---

## 4. Release build & signing

`android/app/build.gradle` reads the upload key from environment variables.
Without them, `assembleRelease` produces an **unsigned** APK (fine for checks,
not uploadable).

### 4.1 Create an upload keystore (once)

```bash
keytool -genkey -v \
  -keystore signaldesk-upload.jks \
  -alias signaldesk \
  -keyalg RSA -keysize 2048 -validity 10000
```

Keep the keystore and passwords outside the repo (password manager / CI secrets).

### 4.2 Signing env vars

| Variable | Value |
| --- | --- |
| `SIGNING_STORE_FILE` | Absolute path to the `.jks` |
| `SIGNING_STORE_PASSWORD` | Keystore password |
| `SIGNING_KEY_ALIAS` | `signaldesk` |
| `SIGNING_KEY_PASSWORD` | Key password |

### 4.3 Build the uploadable AAB

```bash
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@21 \
  ANDROID_HOME=$HOME/Library/Android/sdk \
  SIGNING_STORE_FILE=$HOME/keys/signaldesk-upload.jks \
  SIGNING_STORE_PASSWORD=... SIGNING_KEY_ALIAS=signaldesk SIGNING_KEY_PASSWORD=... \
  ./gradlew :app:bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`.

### 4.4 Play App Signing

Enroll in **Play App Signing** in the Play Console, then upload the AAB. Google
holds the app signing key; yours is only the **upload** key, so a leaked upload
key can be reset through Play support. Keep it safe regardless.

---

## 5. Google Play Console

1. **Register** a developer account (one-time **$25**) at play.google.com/console.
2. **Create the app** with application id `com.signaldesk.app`.
3. **Store listing**: title `SignalDesk`, short + full description, category
   (Finance), screenshots (phone + tablet), a 512×512 icon
   (`android/app/src/main/ic_launcher-playstore.png` is already generated), and a
   1024×500 feature graphic.
4. **Content rating** questionnaire.
5. **Target API level**: keep `targetSdkVersion` at the Play-required level
   (check the console for the current minimum).
6. **Data Safety form** — see §6.

---

## 6. Privacy, data, and policy requirements

### 6.1 Privacy policy URL

- Text exists at `docs/PRIVACY_POLICY.md`.
- **Host it** at a public URL (GitHub Pages / Notion is fine).
- Put that URL in the Play store listing **and** Admin → Settings →
  `privacy_policy_url` (the app already links to it from Settings).

### 6.2 Data Safety form

Declare what the app collects. SignalDesk collects:
- Email + password (account)
- Device ID (per-install) + device push token
- Timezone

Data is encrypted in transit (HTTPS only), and users can delete their account in the app.
The client IP is used in memory for rate limiting and not stored, so it doesn't need
declaring as collected. No precise location, no third-party ad networks. Declare honestly
— the form must match the app's actual behavior.

### 6.3 Account-deletion URL

In-app deletion is implemented (`DELETE /api/auth/me`). Play also wants a **web
URL** where users can request deletion outside the app. Host a small page (or a
`mailto:`/support link) and add it in the console.

### 6.4 Financial-services policy

Trading-signal content may trigger Google's **Financial services** declaration.
Confirm eligibility before submit — some regions restrict this category or need
extra licensing disclosures.

### 6.5 Payments policy (no steering)

Partner access is sold outside the app (Telegram). Play forbids pointing users at
an outside payment for content that unlocks in the app. So the Play build
(`npm run build:play`) is "sign-in only":

- no "Join Our Team" / "How to become a Partner" prompts;
- no Telegram link anywhere (Contact keeps Website, Instagram, e-mail);
- locked signals only say "Already a Partner? Sign in".

Things only you can keep clean:
- **Announcement banner** (Admin → Settings) shows in the Play app too. Never put
  prices, "become a Partner", or a Telegram link in it.
- **Website / Instagram links** stay in the Play app. If those pages sell Partner
  access, the reviewer can treat them as steering too. Point them at pages without a
  purchase path, or blank them in Admin → Settings before review.
- **Store listing text** must not mention buying Partner access.

---

## 7. Firebase security

`android/app/google-services.json` ships inside the APK. **Restrict its API key**
in Google Cloud Console to this app's package (`com.signaldesk.app`) + the SHA-1
fingerprints of **both** the upload key and the Play app-signing key (Play Console →
App integrity), so the key can't be abused elsewhere.

The server-side **service account** is a private key: keep it out of the repo and
the APK, give it only the FCM sender role, and rotate it if it was ever copied around.

---

## 8. Admin-side preparation (before launch)

1. **Set `ADMIN_PASSWORD` (and `ADMIN_USERNAME`) before the first boot** of the
   production server. It's hashed once; to change it later run
   `ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run admin:credentials` on the server.
   Use a non-obvious username and a 16+ character password.
   - **Admin path:** build the *web* app with a secret `VITE_ADMIN_PATH=/ops-<random>`.
     Build the **Android** app *without* it, so the APK contains no admin route.
2. Sign in to the admin panel (secret `VITE_ADMIN_PATH`) and **delete the sample signals** (Signals → *Delete
   sample data*).
3. In **Admin → Settings**, set the real values:
   - Telegram (`@SignalDesk_com`)
   - Website, Instagram, support email
   - `privacy_policy_url`
   - Announcement banner text (optional)
4. Set `member_visible_count` (default 3) and `history_days` (default 14).
5. Fire one test signal and confirm it lands in **Delivery logs** and pushes
   reach a real device.
6. Create a test user and grant **Partner** to verify the unlock flow.

---

## 9. Launch checklist (ordered)

- [ ] Provision a backend URL (domain or PaaS) + HTTPS
- [ ] Deploy the backend with production env vars (incl. FCM + SMTP + `TRUST_PROXY_HOPS`)
- [ ] Host the privacy policy; set its URL in the app + Play listing
- [ ] Create upload keystore; set the `SIGNING_*` env vars; `npm run build:play`; build the AAB
- [ ] Enroll in Play App Signing
- [ ] Register Play Console account ($25); create the app
- [ ] Complete store listing (description, screenshots, icon, feature graphic)
- [ ] Content rating + Data Safety form
- [ ] Add account-deletion web URL
- [ ] Restrict the Firebase API key
- [ ] Financial-services declaration
- [ ] Payments-policy check (§6.5): announcement, website/Instagram links, store listing
- [ ] Admin-side prep (§8)
- [ ] Upload AAB → internal testing → production

---

## 10. Iran-specific options (rial payment + ban-risk flags)

The rule of thumb: **anything touching Google must be foreign; hosting, domain,
and SMTP can be Iranian and paid in rial.**

### 10.1 Critical ban risk — Google Play + Firebase

Google is rolling out mandatory developer identity verification (from late 2026
through 2027). Developers in US-sanctioned countries — **including Iran** — will
not be allowed to verify, so an Iranian-flagged account **cannot distribute
globally** (local APK installs inside Iran still work).

To publish globally you need a developer account under a **non-Iranian entity**:

- a company registered abroad,
- a foreign payment method (for the one-time $25 fee),
- access Play Console from a **non-Iranian IP/VPS**.

This has real legal/compliance implications — get professional advice. It is
also not a guarantee; Google can still terminate an account it later ties to Iran.

**Rule: every Google asset (Play account, Firebase project, FCM service account,
the `google-services.json` origin) must be created from a foreign account/IP.**

### 10.2 Item-by-item

| Item | Buy? | Where | Cost (rough) | Ban risk |
| --- | --- | --- | --- | --- |
| Play developer account | Buy ($25) | **Foreign** | $25 one-time, foreign card | **HIGH** |
| Firebase / FCM | Free | **Foreign** | Free tier | **HIGH** |
| Backend hosting | Buy | Iran **or** foreign | rial (below) or €4–5/mo | Low |
| Domain | Buy | Iran (.ir) or foreign (.com) | .ir a few 100k rial/yr; .com $10–15/yr | Low |
| Privacy / deletion pages | Free | Foreign (GitHub Pages / Cloudflare Pages) | Free | Low |
| SMTP | Free/cheap | Foreign or Iran | free tier or rial provider | Low |
| Release keystore | Free | Local | — | None |

### 10.3 Iranian providers (payable in rial)

| Provider | Type | Rough cost |
| --- | --- | --- |
| ArvanCloud | Cloud VPS + CDN | Free VPS tier; paid from ~a few hundred thousand toman/mo |
| Liara | PaaS (Qom) | Hourly rial billing, cheap; SSL + backups included |
| ParsPack | VPS | ~IRR 4.5–8.3M/month (1 vCPU / 1–2 GB RAM) |

The backend must reach `fcm.googleapis.com` to send push — this works from
Iranian hosting, but a foreign VPS removes any doubt and serves global users with
lower latency.

### 10.4 Foreign low-cost options (need a foreign card)

| Item | Option | Rough cost |
| --- | --- | --- |
| Backend VPS | Hetzner | ~€4–5/mo |
| Backend PaaS | Railway / Render | free–cheap tier |
| SMTP | Brevo / Resend / SendGrid | free tier |
| Static pages | GitHub Pages / Cloudflare Pages / Netlify | free |

---

## Gotchas

- Never put the SQLite DB on ephemeral storage — it's wiped on every deploy.
- `SMTP_FROM` must be a verified domain, or the password-reset email is rejected.
- Set `ADMIN_PASSWORD`, or the server won't boot in production.
- `NODE_ENV=production` is what flips on the security guards — don't forget it.

---

Keep this file updated whenever the deployment story changes.
