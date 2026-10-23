
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { db } from '../lib/db.js';
import type { SignalRow } from './signals.js';
import { changeSummary, getSignalById, isSignalInFreeWindow, listSignalChanges } from './signals.js';
import { isoPlusMs, nowIso } from './util.js';

export type DeviceRow = {
  id: number;
  token: string;
  push_token: string | null;
  user_id: number | null;
  platform: string;
  notifications_enabled: number;
  trading_signals_enabled: number;
  buy_signals_enabled: number;
  sell_signals_enabled: number;
  disabled: number;
  timezone: string | null;
  created_at: string;
  last_seen_at: string | null;
};

type DeviceWithUser = DeviceRow & {
  plan: string | null;
  suspended: number | null;
  pro_end_at: string | null;
};

export type DeliveryKind = 'NEW' | 'UPDATE' | 'DELETE';

export type Eligibility = { eligible: boolean; reason: string };

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5000;

/* ------------------------------ eligibility ------------------------------- */

export function evaluateEligibility(
  device: DeviceWithUser,
  signal: SignalRow,
  kind: DeliveryKind = 'NEW',
): Eligibility {
  if (device.disabled) return { eligible: false, reason: 'device_disabled' };
  if (!device.notifications_enabled) return { eligible: false, reason: 'notifications_off' };
  if (!device.trading_signals_enabled) return { eligible: false, reason: 'trading_signals_off' };

  const action = signal.action.toUpperCase();
  if (action === 'BUY' && !device.buy_signals_enabled) {
    return { eligible: false, reason: 'buy_pref_off' };
  }
  if (action === 'SELL' && !device.sell_signals_enabled) {
    return { eligible: false, reason: 'sell_pref_off' };
  }

  if (device.suspended) return { eligible: false, reason: 'user_suspended' };

  // A correction (or removal) to a signal the device already holds always goes
  // through: withholding it would leave the trader acting on stale numbers.
  if (kind === 'UPDATE') return { eligible: true, reason: 'signal_updated' };
  if (kind === 'DELETE') return { eligible: true, reason: 'signal_deleted' };

  const proActive =
    device.plan === 'PRO' &&
    !device.suspended &&
    Boolean(device.pro_end_at) &&
    new Date(device.pro_end_at as string).getTime() > Date.now();

  if (proActive) return { eligible: true, reason: 'pro_active' };

  return { eligible: true, reason: 'free_quota' };
}

/* ---------------------------- notification copy ---------------------------- */

export function buildNotification(
  signal: SignalRow,
  kind: DeliveryKind,
  revision: number,
): { title: string; body: string } {
  if (kind === 'DELETE') {
    return {
      title: `Deleted: ${signal.action} ${signal.symbol}`,
      body: 'This signal was removed.',
    };
  }
  if (kind === 'UPDATE') {
    const changes = listSignalChanges(signal.id, revision);
    return {
      title: `Updated: ${signal.action} ${signal.symbol}`,
      body: changeSummary(changes),
    };
  }
  return {
    title: `${signal.action} ${signal.symbol}`,
    body: `${signal.strategy_name}${signal.timeframe ? ' • ' + signal.timeframe : ''}`,
  };
}

/**
 * Notification content for a specific device. Free devices get the full text
 * only when the signal is inside their daily visible window (free_visible_count);
 * otherwise the push is a generic "new signal" alert that leaks no details.
 * UPDATE/DELETE always show full text — the device already holds the signal.
 */
export function buildNotificationForDevice(
  deviceId: number,
  signal: SignalRow,
  kind: DeliveryKind,
  revision: number,
): { title: string; body: string } {
  const full = buildNotification(signal, kind, revision);

  const user = db
    .prepare(
      'SELECT u.plan, u.suspended, u.pro_end_at FROM devices d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = ?',
    )
    .get(deviceId) as { plan: string | null; suspended: number | null; pro_end_at: string | null } | undefined;

  const proActive =
    user?.plan === 'PRO' &&
    !user?.suspended &&
    Boolean(user?.pro_end_at) &&
    new Date(user.pro_end_at as string).getTime() > Date.now();

  if (proActive || isSignalInFreeWindow(signal)) return full;

  const generic = { body: 'Upgrade to Pro to view this signal.' };
  if (kind === 'DELETE') return { title: 'Signal removed', ...generic };
  if (kind === 'UPDATE') return { title: 'Signal updated', ...generic };
  return { title: 'New signal released', ...generic };
}

/* ------------------------------ distribution ------------------------------ */

/**
 * Fan a saved signal out into per-device delivery jobs.
 * Called AFTER the signal is persisted and AFTER the request responded.
 * UNIQUE(signal_id, device_id, revision) makes it idempotent per revision, so a
 * replayed webhook or a repeated save never produces a second push.
 *
 * kind = 'NEW'    → every eligible device.
 * kind = 'UPDATE' → only devices that already received this signal.
 */
export function enqueueSignalDistribution(
  signalId: number,
  options: { kind?: DeliveryKind; revision?: number } = {},
): { queued: number; skipped: number } {
  const kind: DeliveryKind = options.kind ?? 'NEW';
  const revision = options.revision ?? 0;
  const signal = getSignalById(signalId);
  if (!signal) return { queued: 0, skipped: 0 };

  const devices =
    kind === 'UPDATE' || kind === 'DELETE'
      ? (db
          .prepare(
            `SELECT d.*, u.plan AS plan, u.suspended AS suspended, u.pro_end_at AS pro_end_at
             FROM devices d
             LEFT JOIN users u ON u.id = d.user_id
             WHERE d.disabled = 0
               AND EXISTS (
                 SELECT 1 FROM delivery_jobs j
                 WHERE j.device_id = d.id AND j.signal_id = ? AND j.status IN ('SENT','DELIVERED')
               )`,
          )
          .all(signal.id) as DeviceWithUser[])
      : (db
          .prepare(
            `SELECT d.*, u.plan AS plan, u.suspended AS suspended, u.pro_end_at AS pro_end_at
             FROM devices d LEFT JOIN users u ON u.id = d.user_id
             WHERE d.disabled = 0`,
          )
          .all() as DeviceWithUser[]);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO delivery_jobs
       (signal_id, device_id, user_id, kind, revision, status, reason, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  );

  let queued = 0;
  let skipped = 0;
  const now = nowIso();

  for (const device of devices) {
    try {
      const decision = evaluateEligibility(device, signal, kind);
      insert.run(
        signal.id,
        device.id,
        device.user_id,
        kind,
        revision,
        decision.eligible ? 'PENDING' : 'SKIPPED',
        decision.reason,
        now,
        now,
      );
      if (decision.eligible) queued += 1;
      else skipped += 1;
    } catch (err) {
      console.error('[distribution] failed to enqueue for device', device.id, err);
    }
  }

  console.log(
    `[distribution] signal #${signal.id} ${signal.symbol} (${kind} rev ${revision}): queued=${queued} skipped=${skipped}`,
  );
  return { queued, skipped };
}

/* -------------------------------- transport -------------------------------- */

export type TransportResult = { ok: boolean; retriable: boolean; invalidToken?: boolean; error?: string };

/** A Firebase service-account key (Project settings → Service accounts → Generate new private key). */
type ServiceAccount = { project_id: string; client_email: string; private_key: string };

/**
 * Loads the FCM service account from an inline JSON env var (FCM_SERVICE_ACCOUNT_JSON)
 * or a file path (GOOGLE_APPLICATION_CREDENTIALS). Returns null when push is not
 * configured, in which case delivery degrades to the device pulling
 * /api/notifications/pending.
 */
function loadServiceAccount(): ServiceAccount | null {
  const inline = process.env.FCM_SERVICE_ACCOUNT_JSON;
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    const raw = inline ?? (path ? readFileSync(path, 'utf8') : null);
    if (!raw) return null;
    const sa = JSON.parse(raw) as ServiceAccount;
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch (err) {
    console.error('[fcm] could not read service account:', (err as Error).message);
    return null;
  }
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

/** Exchanges the service account for an OAuth2 access token (cached for ~1h). */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(sa.private_key).toString('base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!res.ok) throw new Error('fcm oauth failed: ' + res.status);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

/**
 * Push transport. With a service account configured the message is handed to FCM
 * HTTP v1 addressed to the device's FCM registration token (push_token); otherwise
 * the job is parked as SENT and the device picks it up from
 * /api/notifications/pending the moment it is running.
 * Adding Telegram (or any other channel) later means adding a function here —
 * the webhook and the signal service do not change.
 */
export async function transportSend(
  device: DeviceRow,
  signal: SignalRow,
  kind: DeliveryKind = 'NEW',
  revision = 0,
): Promise<TransportResult> {
  const sa = loadServiceAccount();
  const target = device.push_token ?? null;
  if (!sa || !target) return { ok: true, retriable: false };

  const content = buildNotificationForDevice(device.id, signal, kind, revision);
  const payload = {
    message: {
      token: target,
      notification: { title: content.title, body: content.body },
      data: {
        type: 'TRADING_SIGNAL',
        event: kind === 'UPDATE' ? 'SIGNAL_UPDATED' : kind === 'DELETE' ? 'SIGNAL_DELETED' : 'SIGNAL_CREATED',
        signalId: String(signal.id),
        revision: String(revision),
      },
      android: { priority: 'high' },
    },
  };

  try {
    const accessToken = await getAccessToken(sa);
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true, retriable: false };

    const body = (await res.json().catch(() => ({}))) as {
      error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
    };
    const code = body.error?.details?.find((d) => d.errorCode)?.errorCode;
    const status = body.error?.status;

    // A dead registration token — disable the device rather than retrying forever.
    if (code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') {
      return { ok: false, retriable: false, invalidToken: true, error: code };
    }
    if (status === 'UNAUTHENTICATED' || status === 'PERMISSION_DENIED') {
      return { ok: false, retriable: false, error: 'fcm auth rejected: ' + (body.error?.message ?? status) };
    }
    if (res.status >= 500 || status === 'UNAVAILABLE' || status === 'INTERNAL') {
      return { ok: false, retriable: true, error: 'fcm ' + res.status };
    }
    return { ok: false, retriable: false, error: body.error?.message ?? 'fcm ' + res.status };
  } catch (err) {
    return { ok: false, retriable: true, error: (err as Error).message };
  }
}

/* --------------------------------- worker --------------------------------- */

type JobRow = {
  id: number;
  signal_id: number;
  device_id: number;
  attempts: number;
  kind: string;
  revision: number;
};

async function processJob(job: JobRow): Promise<void> {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(job.device_id) as
    | DeviceRow
    | undefined;
  const signal = getSignalById(job.signal_id);

  if (!device || !signal) {
    db.prepare("UPDATE delivery_jobs SET status = 'FAILED', last_error = ? WHERE id = ?").run(
      'device or signal missing',
      job.id,
    );
    return;
  }

  const kind: DeliveryKind = job.kind === 'UPDATE' ? 'UPDATE' : job.kind === 'DELETE' ? 'DELETE' : 'NEW';
  const result = await transportSend(device, signal, kind, job.revision ?? 0);
  const attempts = job.attempts + 1;

  if (result.ok) {
    db.prepare(
      "UPDATE delivery_jobs SET status = 'SENT', attempts = ?, sent_at = ?, last_error = NULL WHERE id = ?",
    ).run(attempts, nowIso(), job.id);
    return;
  }

  if (result.invalidToken) {
    db.prepare('UPDATE devices SET disabled = 1 WHERE id = ?').run(device.id);
    db.prepare("UPDATE delivery_jobs SET status = 'FAILED', attempts = ?, last_error = ? WHERE id = ?").run(
      attempts,
      'invalid device token — device disabled',
      job.id,
    );
    console.warn('[worker] disabled device', device.id, 'invalid token');
    return;
  }

  if (!result.retriable || attempts >= MAX_ATTEMPTS) {
    db.prepare("UPDATE delivery_jobs SET status = 'FAILED', attempts = ?, last_error = ? WHERE id = ?").run(
      attempts,
      result.error ?? 'delivery failed',
      job.id,
    );
    return;
  }

  const backoff = BASE_BACKOFF_MS * 2 ** (attempts - 1);
  db.prepare(
    "UPDATE delivery_jobs SET status = 'RETRY', attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?",
  ).run(attempts, isoPlusMs(backoff), result.error ?? 'delivery failed', job.id);
}

export async function processQueueOnce(limit = 25): Promise<number> {
  const jobs = db
    .prepare(
      `SELECT id, signal_id, device_id, attempts, kind, revision FROM delivery_jobs
       WHERE status IN ('PENDING','RETRY') AND next_attempt_at <= ?
       ORDER BY id ASC LIMIT ?`,
    )
    .all(nowIso(), limit) as JobRow[];

  for (const job of jobs) {
    try {
      // One failing device must never block the rest of the queue.
      await processJob(job);
    } catch (err) {
      console.error('[worker] job', job.id, 'threw', err);
      db.prepare("UPDATE delivery_jobs SET status = 'RETRY', next_attempt_at = ?, last_error = ? WHERE id = ?").run(
        isoPlusMs(BASE_BACKOFF_MS),
        (err as Error).message,
        job.id,
      );
    }
  }
  return jobs.length;
}

let workerTimer: NodeJS.Timeout | null = null;

export function startWorker(intervalMs = 3000): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    processQueueOnce().catch((err) => console.error('[worker] loop error', err));
  }, intervalMs);
  console.log('[worker] delivery worker started');
}

/* ----------------------------- device pull side ---------------------------- */

export function pendingForDevice(
  deviceId: number,
): { jobId: number; signalId: number; kind: DeliveryKind; revision: number }[] {
  const rows = db
    .prepare(
      `SELECT id, signal_id, kind, revision FROM delivery_jobs
       WHERE device_id = ? AND status = 'SENT' AND delivered_at IS NULL
       ORDER BY id ASC LIMIT 20`,
    )
    .all(deviceId) as { id: number; signal_id: number; kind: string; revision: number }[];
  return rows.map((r) => ({
    jobId: r.id,
    signalId: r.signal_id,
    kind: r.kind === 'UPDATE' ? 'UPDATE' : r.kind === 'DELETE' ? 'DELETE' : 'NEW',
    revision: r.revision ?? 0,
  }));
}

export function markDelivered(jobIds: number[]): void {
  const stmt = db.prepare("UPDATE delivery_jobs SET status = 'DELIVERED', delivered_at = ? WHERE id = ?");
  const now = nowIso();
  for (const id of jobIds) stmt.run(now, id);
}
