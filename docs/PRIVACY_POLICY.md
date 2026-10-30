# Privacy Policy — SignalDesk

*Last updated: 2026-10-30*

SignalDesk is a trading-signal app. It provides market signals for educational
guidance only — it is **not a broker** and does not execute trades or access your
broker/exchange account.

This policy explains what data the app collects, how it is used, and how you can
delete it.

## 1. Data we collect

| Data | Purpose |
| --- | --- |
| Email address | Account sign-in and recovery. |
| Password (stored as a salted hash) | Account sign-in. Never stored in plain text. |
| Device identifier | An anonymous per-install ID used to deliver your notifications. |
| Push token | A Firebase Cloud Messaging token used to send you signal alerts. |
| Timezone | To show signal times in your local time. |
| Notification preferences | Whether you want alerts on or off. |

## 2. Data we do NOT collect

- Payment or billing information
- Your exchange/broker account or any trading account
- Precise location
- Contacts, photos, or other device files

## 3. How we use your data

- To create and secure your account.
- To deliver trading-signal alerts to your device.
- To remember your preferences across sessions.

We do **not** sell your data.

## 4. Third-party services

We use **Firebase Cloud Messaging** (Google) to deliver push notifications. Your
device's push token is sent to Google to route the alerts. Google's handling of that
data is governed by Google's own privacy policy.

## 5. Data retention & deletion

- Your data is kept for as long as your account is active.
- You can **delete your account at any time** from the app (Account → Delete account).
  This permanently removes your email, password, and account data.

## 6. Security

- Passwords are stored hashed (scrypt with a per-user salt).
- Communication with the backend is encrypted in transit (HTTPS only; the app
  refuses unencrypted connections).
- Sign-in sessions are stored only as one-way hashes, expire after 30 days without
  use, and are limited to 3 devices per account. Signing out or resetting your
  password ends them.
- Your IP address is used briefly, in memory only, to block repeated failed
  sign-in attempts. It is not stored.

## 7. Contact

For privacy questions or data requests, contact us at:

- Email: `support@signaldesk.example.com`
- Telegram: `https://t.me/SignalDesk_com`
