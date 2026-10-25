# SignalDesk — backend deployment

The app needs a **backend server** running somewhere with a public HTTPS URL.
Google Play only distributes the Android APK — it does **not** run the server.

## What you deploy

- **Backend:** `server/` (Node + SQLite). This is the only process that must be hosted.
- **Android app:** built separately and uploaded to Google Play. It reaches the backend
  over the network via `VITE_API_BASE_URL`.

The backend is a pure `/api` server — it does **not** serve the web frontend. If you also
want the web app at a URL, serve `dist/` separately and proxy `/api` to the backend.

## Hard requirements

1. **Node 22.5+** — the backend uses the built-in `node:sqlite` module. Use Node 22 LTS or 24.
2. **Persistent disk** — `server/data/app.db` must survive restarts. Serverless platforms
   (Vercel, Netlify Functions, Cloudflare Workers) cannot run this.
3. **Environment variables** — see below.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | no | Default `3001`. |
| `TRADINGVIEW_WEBHOOK_SECRET` | **yes in production** | Server refuses to boot on the default. |
| `ADMIN_PASSWORD` | **yes in production** | Server refuses to boot on the default. |
| `APP_URL` | yes | Public origin used to build password-reset links. |
| `SMTP_HOST` · `SMTP_PORT` · `SMTP_SECURE` · `SMTP_USER` · `SMTP_PASS` · `SMTP_FROM` | yes (for reset email) | `SMTP_FROM` must be a domain verified in your email provider. |
| `GOOGLE_APPLICATION_CREDENTIALS` or `FCM_SERVICE_ACCOUNT_JSON` | no (push) | Enables FCM push; without it Android gets no notifications. |

## Easiest option — Railway

1. Push the repo to GitHub.
2. Railway → New Project → **Deploy from GitHub repo**.
3. Add a **Volume** mounted at `/app/server/data` (that is where the SQLite DB lives).
4. Add the environment variables above.
5. Set the start command to `npm run server` (Railway auto-detects Node).

## Alternative — a VPS (DigitalOcean / Hetzner / Linode)

```bash
git clone <your-repo-url> && cd signalMaster
nvm install 22 && nvm use 22
npm install
npm run build            # only needed if you build the APK on this box
# export the env vars, then:
npm run server
```

Keep it running with `pm2` (or a systemd unit) and put HTTPS in front with Caddy or nginx.

## After the backend is up

- Build the APK with the backend URL baked in:
  ```bash
  VITE_API_BASE_URL=https://your-backend.com npm run build
  npx cap sync android
  ```
- TradingView webhook URL: `https://your-backend.com/api/webhooks/tradingview`
- Sign in to `/admin`, delete the sample signals, and set the contact links.

## Gotchas

- Never put the SQLite DB on ephemeral storage — it is wiped on every deploy.
- `SMTP_FROM` must be a verified domain, or the password-reset email is rejected.
- Set `TRADINGVIEW_WEBHOOK_SECRET` and `ADMIN_PASSWORD`, or the server won't boot in production.
