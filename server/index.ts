import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { db } from './lib/db.js';
import {
  allSettings,
  getSetting,
  initDatabase,
  setSetting,
} from './core/schema.js';
import {
  adminLogin,
  adminLogout,
  bearer,
  createUser,
  currentUser,
  expireProSubscriptions,
  findUserByEmail,
  isAdmin,
  isProActive,
  login,
  logout,
  publicUser,
  touchUser,
  type UserRow,
} from './core/auth.js';
import {
  closeSignalById,
  deleteSampleSignals,
  deleteSignal,
  getSignalById,
  ingestWebhookPayload,
  listSignalChanges,
  listSignals,
  performanceStats,
  publicSignal,
  publishSignal,
  rawPublicSignal,
  updateSignal,
  type SignalPatch,
} from './core/signals.js';
import {
  buildNotificationForDevice,
  enqueueSignalDistribution,
  markDelivered,
  pendingForDevice,
  startWorker,
  type DeviceRow,
} from './core/distribution.js';
import {
  clientIp,
  header,
  isEmail,
  match,
  nowIso,
  randomToken,
  rateLimit,
  readJson,
  safeEqual,
  sendJson,
  toNumber,
  toStr,
} from './core/util.js';

initDatabase();
startWorker();

// Scheduled job: expire PRO subscriptions once a minute.
expireProSubscriptions();
setInterval(() => {
  try {
    expireProSubscriptions();
  } catch (err) {
    console.error('[cron] expiry job failed', err);
  }
}, 60_000);

const WEBHOOK_SECRET = process.env.TRADINGVIEW_WEBHOOK_SECRET || 'change-me-tradingview-secret';

/* ------------------------------- helpers --------------------------------- */

function getDevice(req: IncomingMessage): DeviceRow | null {
  const token = header(req, 'x-device-token');
  if (!token) return null;
  const row = db.prepare('SELECT * FROM devices WHERE token = ?').get(token) as DeviceRow | undefined;
  return row ?? null;
}

function viewerIsPro(req: IncomingMessage): { user: UserRow | null; isPro: boolean } {
  const user = currentUser(req);
  if (user) touchUser(user.id);
  return { user, isPro: isProActive(user) };
}

function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
  if (!isAdmin(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

function logWebhook(externalId: string | null, outcome: string, message: string): void {
  db.prepare(
    'INSERT INTO webhook_events (external_signal_id, outcome, message, created_at) VALUES (?, ?, ?, ?)',
  ).run(externalId, outcome, message, nowIso());
}

/* -------------------------------- routes ---------------------------------- */

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = (req.method ?? 'GET').toUpperCase();
  let params: Record<string, string> | null;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-device-token,x-admin-token,x-webhook-secret',
    });
    res.end();
    return;
  }

  /* ------------------------------- health -------------------------------- */

  if (method === 'GET' && path === '/api/health') {
    sendJson(res, 200, { ok: true, time: nowIso() });
    return;
  }

  if (method === 'GET' && path === '/api/config') {
    const s = allSettings();
    sendJson(res, 200, {
      telegramUrl: s.telegram_url,
      websiteUrl: s.website_url,
      instagramUrl: s.instagram_url,
      supportEmail: s.support_email,
      freeVisibleCount: Number(s.free_visible_count),
      historyDays: Number(s.history_days),
      stats: performanceStats(),
    });
    return;
  }

  /* ---------------------------- TradingView -------------------------------- */

  if (method === 'POST' && path === '/api/webhooks/tradingview') {
    const ip = clientIp(req);
    if (!rateLimit('webhook:' + ip, 60, 60_000)) {
      logWebhook(null, 'RATE_LIMITED', 'too many requests from ' + ip);
      sendJson(res, 429, { error: 'rate limited' });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await readJson(req);
    } catch {
      logWebhook(null, 'INVALID_PAYLOAD', 'body was not valid JSON');
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }

    const provided = header(req, 'x-webhook-secret') || String(payload.secret ?? '');
    if (!safeEqual(provided, WEBHOOK_SECRET)) {
      // never log the secret itself
      logWebhook(null, 'INVALID_SECRET', 'rejected request from ' + ip);
      sendJson(res, 401, { error: 'invalid secret' });
      return;
    }
    delete payload.secret;

    const result = ingestWebhookPayload(payload);
    if (!result.ok) {
      logWebhook(null, 'INVALID_PAYLOAD', result.error);
      sendJson(res, 422, { error: result.error });
      return;
    }

    if (!result.created) {
      logWebhook(result.signal.external_signal_id, 'DUPLICATE', 'idempotent replay ignored');
      sendJson(res, 200, { ok: true, duplicate: true, signalId: result.signal.id });
      return;
    }

    logWebhook(result.signal.external_signal_id, 'ACCEPTED', `${result.signal.action} ${result.signal.symbol}`);
    // Respond immediately; distribution happens outside the request.
    sendJson(res, 202, { ok: true, duplicate: false, signalId: result.signal.id });

    setImmediate(() => {
      try {
        enqueueSignalDistribution(result.signal.id);
      } catch (err) {
        console.error('[webhook] distribution failed for signal', result.signal.id, err);
      }
    });
    return;
  }

  /* ------------------------------- devices --------------------------------- */

  if (method === 'POST' && path === '/api/devices/push-token') {
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }
    const token = toStr(body.token, 300);
    if (!token) {
      sendJson(res, 400, { error: 'token is required' });
      return;
    }
    const user = currentUser(req);
    const platform = toStr(body.platform, 20) ?? 'web';
    const timezone = toStr(body.timezone, 60);
    // The install identity (`token`, sent back as x-device-token) is stable; the
    // FCM registration token (`pushToken`) rotates and is only the delivery target.
    const pushToken = toStr(body.pushToken, 4096);
    const prefs = (body.preferences ?? {}) as Record<string, unknown>;
    const bool = (v: unknown, fallback = 1) => (v === undefined ? fallback : v ? 1 : 0);
    const now = nowIso();

    const existing = db.prepare('SELECT * FROM devices WHERE token = ?').get(token) as
      | DeviceRow
      | undefined;

    if (existing) {
      db.prepare(
        `UPDATE devices SET user_id = ?, platform = ?, timezone = ?, disabled = 0, last_seen_at = ?,
           push_token = COALESCE(?, push_token),
           notifications_enabled = ?, trading_signals_enabled = ?, buy_signals_enabled = ?, sell_signals_enabled = ?
         WHERE id = ?`,
      ).run(
        user ? user.id : existing.user_id,
        platform,
        timezone ?? existing.timezone,
        now,
        pushToken,
        bool(prefs.tradingNotificationsEnabled ?? prefs.notificationsEnabled, existing.notifications_enabled),
        bool(prefs.tradingSignalsEnabled, existing.trading_signals_enabled),
        bool(prefs.buySignalsEnabled, existing.buy_signals_enabled),
        bool(prefs.sellSignalsEnabled, existing.sell_signals_enabled),
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO devices
           (token, push_token, user_id, platform, timezone, notifications_enabled, trading_signals_enabled,
            buy_signals_enabled, sell_signals_enabled, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        token,
        pushToken,
        user ? user.id : null,
        platform,
        timezone,
        bool(prefs.tradingNotificationsEnabled ?? prefs.notificationsEnabled),
        bool(prefs.tradingSignalsEnabled),
        bool(prefs.buySignalsEnabled),
        bool(prefs.sellSignalsEnabled),
        now,
        now,
      );
    }

    const device = db.prepare('SELECT * FROM devices WHERE token = ?').get(token) as DeviceRow;
    sendJson(res, 200, {
      id: device.id,
      token: device.token,
      preferences: {
        notificationsEnabled: Boolean(device.notifications_enabled),
        tradingSignalsEnabled: Boolean(device.trading_signals_enabled),
        buySignalsEnabled: Boolean(device.buy_signals_enabled),
        sellSignalsEnabled: Boolean(device.sell_signals_enabled),
      },
    });
    return;
  }

  params = match('/api/devices/push-token/:id', path);
  if (method === 'DELETE' && params) {
    const device = getDevice(req);
    const id = Number(params.id);
    if (!device || device.id !== id) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    db.prepare('DELETE FROM devices WHERE id = ?').run(id);
    sendJson(res, 200, { ok: true });
    return;
  }

  /* --------------------------- notifications ------------------------------- */

  if (method === 'GET' && path === '/api/notifications/pending') {
    const device = getDevice(req);
    if (!device) {
      sendJson(res, 200, { items: [] });
      return;
    }
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(nowIso(), device.id);
    const pending = pendingForDevice(device.id);
    const items = pending
      .map((p) => {
        const signal = getSignalById(p.signalId);
        if (!signal) return null;
        const content = buildNotificationForDevice(device.id, signal, p.kind, p.revision);
        return {
          jobId: p.jobId,
          type: 'TRADING_SIGNAL' as const,
          kind: p.kind,
          revision: p.revision,
          signalId: signal.id,
          title: content.title,
          body: content.body,
        };
      })
      .filter(Boolean);
    sendJson(res, 200, { items });
    return;
  }

  if (method === 'POST' && path === '/api/notifications/ack') {
    const device = getDevice(req);
    if (!device) {
      sendJson(res, 403, { error: 'unknown device' });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }
    const ids = Array.isArray(body.jobIds) ? body.jobIds.map((v) => Number(v)).filter(Number.isFinite) : [];
    markDelivered(ids);
    sendJson(res, 200, { ok: true, acknowledged: ids.length });
    return;
  }

  /* -------------------------------- signals -------------------------------- */

  if (method === 'GET' && path === '/api/signals') {
    const { isPro } = viewerIsPro(req);
    const statusParam = (url.searchParams.get('status') ?? 'open').toLowerCase();
    const status = statusParam === 'closed' || statusParam === 'all' ? statusParam : 'open';
    const data = listSignals({
      status: status as 'open' | 'closed' | 'all',
      market: url.searchParams.get('market'),
      page: Number(url.searchParams.get('page') ?? '1') || 1,
      pageSize: Number(url.searchParams.get('pageSize') ?? '15') || 15,
      isPro,
    });
    sendJson(res, 200, { ...data, isPro });
    return;
  }

  params = match('/api/signals/:id', path);
  if (method === 'GET' && params) {
    const { isPro } = viewerIsPro(req);
    const id = Number(params.id);
    if (!Number.isFinite(id)) {
      sendJson(res, 400, { error: 'invalid id' });
      return;
    }
    const row = getSignalById(id);
    if (!row || row.deleted_at) {
      sendJson(res, 404, { error: 'signal not found' });
      return;
    }
    const view = publicSignal(row, isPro);
    if (view.locked) {
      sendJson(res, 403, { error: 'pro_required', locked: true, signal: view });
      return;
    }
    view.changes = listSignalChanges(id);
    sendJson(res, 200, { signal: view });
    return;
  }

  /* --------------------------------- auth ---------------------------------- */

  if (method === 'POST' && path === '/api/auth/signup') {
    const ip = clientIp(req);
    if (!rateLimit('signup:' + ip, 10, 60_000)) {
      sendJson(res, 429, { error: 'too many attempts, try again in a minute' });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }
    const email = (toStr(body.email, 120) ?? '').toLowerCase();
    const password = toStr(body.password, 200) ?? '';
    if (!isEmail(email)) {
      sendJson(res, 422, { error: 'Please enter a valid email address.' });
      return;
    }
    if (password.length < 8) {
      sendJson(res, 422, { error: 'Password must be at least 8 characters.' });
      return;
    }
    if (findUserByEmail(email)) {
      sendJson(res, 409, { error: 'An account with this email already exists.' });
      return;
    }
    try {
      createUser(email, password, toStr(body.timezone, 60));
      const session = login(email, password);
      if (!session) {
        sendJson(res, 500, { error: 'Could not start a session. Please sign in.' });
        return;
      }
      const deviceToken = header(req, 'x-device-token');
      if (deviceToken) {
        db.prepare('UPDATE devices SET user_id = ? WHERE token = ?').run(session.user.id, deviceToken);
      }
      sendJson(res, 201, { token: session.token, user: publicUser(session.user) });
    } catch (err) {
      console.error('[auth] signup failed', err);
      sendJson(res, 500, { error: 'Could not create the account.' });
    }
    return;
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const ip = clientIp(req);
    if (!rateLimit('login:' + ip, 15, 60_000)) {
      sendJson(res, 429, { error: 'too many attempts, try again in a minute' });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }
    const email = (toStr(body.email, 120) ?? '').toLowerCase();
    const password = toStr(body.password, 200) ?? '';
    const session = login(email, password);
    if (!session) {
      sendJson(res, 401, { error: 'Email or password is incorrect.' });
      return;
    }
    const deviceToken = header(req, 'x-device-token');
    if (deviceToken) {
      db.prepare('UPDATE devices SET user_id = ? WHERE token = ?').run(session.user.id, deviceToken);
    }
    sendJson(res, 200, { token: session.token, user: publicUser(session.user) });
    return;
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    const token = bearer(req);
    if (token) logout(token);
    const deviceToken = header(req, 'x-device-token');
    if (deviceToken) db.prepare('UPDATE devices SET user_id = NULL WHERE token = ?').run(deviceToken);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && path === '/api/auth/me') {
    const user = currentUser(req);
    if (!user) {
      sendJson(res, 200, { user: null });
      return;
    }
    touchUser(user.id);
    const device = getDevice(req);
    sendJson(res, 200, {
      user: publicUser(user),
      device: device
        ? {
            id: device.id,
          }
        : null,
    });
    return;
  }

  if (method === 'PATCH' && path === '/api/auth/timezone') {
    const user = currentUser(req);
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }
    const timezone = toStr(body.timezone, 60);
    if (!timezone) {
      sendJson(res, 422, { error: 'timezone is required' });
      return;
    }
    if (user) db.prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone, user.id);
    const deviceToken = header(req, 'x-device-token');
    if (deviceToken) db.prepare('UPDATE devices SET timezone = ? WHERE token = ?').run(timezone, deviceToken);
    sendJson(res, 200, { ok: true, timezone });
    return;
  }

  /* -------------------------------- admin ---------------------------------- */

  if (method === 'POST' && path === '/api/admin/login') {
    const ip = clientIp(req);
    if (!rateLimit('admin:' + ip, 10, 60_000)) {
      sendJson(res, 429, { error: 'too many attempts' });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }
    const token = adminLogin(toStr(body.username, 60) ?? '', toStr(body.password, 200) ?? '');
    if (!token) {
      sendJson(res, 401, { error: 'Invalid credentials.' });
      return;
    }
    sendJson(res, 200, { token });
    return;
  }

  if (method === 'POST' && path === '/api/admin/logout') {
    adminLogout(req);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && path === '/api/admin/overview') {
    if (!requireAdmin(req, res)) return;
    const users = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    const pro = db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE plan = 'PRO' AND pro_end_at > ?")
      .get(nowIso()) as { c: number };
    const devices = db.prepare('SELECT COUNT(*) AS c FROM devices WHERE disabled = 0').get() as { c: number };
    const signals = db.prepare('SELECT COUNT(*) AS c FROM signals').get() as { c: number };
    const sent = db
      .prepare("SELECT COUNT(*) AS c FROM delivery_jobs WHERE status IN ('SENT','DELIVERED')")
      .get() as { c: number };
    const failed = db.prepare("SELECT COUNT(*) AS c FROM delivery_jobs WHERE status = 'FAILED'").get() as {
      c: number;
    };
    const edited = db.prepare('SELECT COUNT(*) AS c FROM signals WHERE edit_count > 0').get() as { c: number };
    sendJson(res, 200, {
      users: users.c,
      proUsers: pro.c,
      devices: devices.c,
      signals: signals.c,
      pushSent: sent.c,
      pushFailed: failed.c,
      editedSignals: edited.c,
      performance: performanceStats(),
      webhookSecretConfigured: Boolean(process.env.TRADINGVIEW_WEBHOOK_SECRET),
    });
    return;
  }

  if (method === 'GET' && path === '/api/admin/users') {
    if (!requireAdmin(req, res)) return;
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const rows = q
      ? (db
          .prepare('SELECT * FROM users WHERE email LIKE ? ORDER BY id DESC LIMIT 200')
          .all('%' + q + '%') as UserRow[])
      : (db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 200').all() as UserRow[]);
    sendJson(res, 200, { items: rows.map(publicUser) });
    return;
  }

  params = match('/api/admin/users/:id/plan', path);
  if (method === 'POST' && params) {
    if (!requireAdmin(req, res)) return;
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }
    const id = Number(params.id);
    const plan = (toStr(body.plan, 10) ?? 'FREE').toUpperCase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!user) {
      sendJson(res, 404, { error: 'user not found' });
      return;
    }
    if (plan === 'PRO') {
      const days = toNumber(body.days) ?? 30;
      if (days <= 0 || days > 3650) {
        sendJson(res, 422, { error: 'days must be between 1 and 3650' });
        return;
      }
      const start = nowIso();
      const end = new Date(Date.now() + days * 86400000).toISOString();
      db.prepare(
        "UPDATE users SET plan = 'PRO', subscription_status = 'ACTIVE', pro_start_at = ?, pro_end_at = ? WHERE id = ?",
      ).run(start, end, id);
      console.log(`[admin] user ${user.email} upgraded to PRO for ${days} day(s)`);
    } else {
      db.prepare(
        "UPDATE users SET plan = 'FREE', subscription_status = 'INACTIVE', pro_end_at = ? WHERE id = ?",
      ).run(nowIso(), id);
      console.log(`[admin] user ${user.email} moved back to FREE`);
    }
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    sendJson(res, 200, { user: publicUser(updated) });
    return;
  }

  params = match('/api/admin/users/:id/suspend', path);
  if (method === 'POST' && params) {
    if (!requireAdmin(req, res)) return;
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      body = {};
    }
    const suspended = body.suspended ? 1 : 0;
    db.prepare('UPDATE users SET suspended = ? WHERE id = ?').run(suspended, Number(params.id));
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id)) as
      | UserRow
      | undefined;
    if (!updated) {
      sendJson(res, 404, { error: 'user not found' });
      return;
    }
    sendJson(res, 200, { user: publicUser(updated) });
    return;
  }

  if (method === 'GET' && path === '/api/admin/signals') {
    if (!requireAdmin(req, res)) return;
    const page = Number(url.searchParams.get('page') ?? '1') || 1;
    const data = listSignals({ status: 'all', page, pageSize: 25, isPro: true });
    sendJson(res, 200, data);
    return;
  }

  if (method === 'POST' && path === '/api/admin/signals') {
    if (!requireAdmin(req, res)) return;
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }
    const isDraft = Boolean(body.draft);
    const payload = { ...body, id: toStr(body.id, 120) ?? 'manual-' + randomToken(8) };
    const result = ingestWebhookPayload(payload);
    if (!result.ok) {
      sendJson(res, 422, { error: result.error });
      return;
    }
    if (isDraft) {
      db.prepare("UPDATE signals SET status = 'DRAFT' WHERE id = ?").run(result.signal.id);
    }
    const created = getSignalById(result.signal.id)!;
    sendJson(res, 201, { signal: rawPublicSignal(created) });
    if (!isDraft) {
      setImmediate(() => {
        try {
          enqueueSignalDistribution(result.signal.id);
        } catch (err) {
          console.error('[admin] distribution failed', err);
        }
      });
    }
    return;
  }

  params = match('/api/admin/signals/:id/publish', path);
  if (method === 'POST' && params) {
    if (!requireAdmin(req, res)) return;
    const id = Number(params.id);
    const signal = publishSignal(id);
    if (!signal) {
      sendJson(res, 404, { error: 'draft not found' });
      return;
    }
    sendJson(res, 200, { signal: rawPublicSignal(signal) });
    setImmediate(() => {
      try {
        enqueueSignalDistribution(id);
      } catch (err) {
        console.error('[admin] publish distribution failed for signal', id, err);
      }
    });
    return;
  }

  params = match('/api/admin/signals/:id/close', path);
  if (method === 'POST' && params) {
    if (!requireAdmin(req, res)) return;
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      body = {};
    }
    const id = Number(params.id);
    const row = getSignalById(id);
    if (!row) {
      sendJson(res, 404, { error: 'signal not found' });
      return;
    }
    const updated = closeSignalById(id, toNumber(body.closePrice), toStr(body.result, 12));
    sendJson(res, 200, { signal: updated ? rawPublicSignal(updated) : null });
    return;
  }

  params = match('/api/admin/signals/:id/changes', path);
  if (method === 'GET' && params) {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { changes: listSignalChanges(Number(params.id)) });
    return;
  }

  /**
   * Edit an already published signal. Every modified field is written to the
   * change log, the revision is bumped, and an "updated" notice is queued for
   * the devices that already received this signal.
   */
  params = match('/api/admin/signals/:id', path);
  if (method === 'PATCH' && params) {
    if (!requireAdmin(req, res)) return;
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }
    const id = Number(params.id);
    if (!Number.isFinite(id)) {
      sendJson(res, 400, { error: 'invalid id' });
      return;
    }

    const patch: SignalPatch = {};
    if (body.symbol !== undefined) patch.symbol = toStr(body.symbol, 40);
    if (body.action !== undefined) patch.action = toStr(body.action, 12);
    if (body.market !== undefined) patch.market = toStr(body.market, 20);
    if (body.price !== undefined) patch.price = toNumber(body.price);
    if (body.stopLoss !== undefined) patch.stopLoss = toNumber(body.stopLoss);
    if (body.takeProfits !== undefined) patch.takeProfits = body.takeProfits;
    if (body.timeframe !== undefined) patch.timeframe = toStr(body.timeframe, 12);
    if (body.strategy !== undefined || body.strategyName !== undefined) {
      patch.strategyName = toStr(body.strategy ?? body.strategyName, 80);
    }
    if (body.note !== undefined) patch.note = toStr(body.note, 500);
    if (body.status !== undefined) patch.status = toStr(body.status, 10);
    if (body.result !== undefined) patch.result = toStr(body.result, 12);
    if (body.closePrice !== undefined) patch.closePrice = toNumber(body.closePrice);

    const result = updateSignal(id, patch);
    if (!result.ok) {
      sendJson(res, result.error === 'signal not found' ? 404 : 422, { error: result.error });
      return;
    }

    const view = rawPublicSignal(result.signal);
    view.changes = listSignalChanges(id);
    const notify = body.notify === undefined ? true : Boolean(body.notify);
    sendJson(res, 200, {
      signal: view,
      changes: result.changes,
      revision: result.revision,
      notified: notify && result.changes.length > 0,
    });

    if (notify && result.changes.length > 0) {
      setImmediate(() => {
        try {
          enqueueSignalDistribution(id, { kind: 'UPDATE', revision: result.revision });
        } catch (err) {
          console.error('[admin] update distribution failed for signal', id, err);
        }
      });
    }
    return;
  }

  params = match('/api/admin/signals/:id', path);
  if (method === 'DELETE' && params) {
    if (!requireAdmin(req, res)) return;
    const id = Number(params.id);
    const removed = deleteSignal(id);
    sendJson(res, 200, { ok: true, removed: Boolean(removed) });
    if (removed) {
      setImmediate(() => {
        try {
          enqueueSignalDistribution(id, { kind: 'DELETE' });
        } catch (err) {
          console.error('[admin] delete distribution failed for signal', id, err);
        }
      });
    }
    return;
  }

  if (method === 'DELETE' && path === '/api/admin/sample-signals') {
    if (!requireAdmin(req, res)) return;
    const removed = deleteSampleSignals();
    sendJson(res, 200, { ok: true, removed });
    return;
  }

  if (method === 'GET' && path === '/api/admin/logs') {
    if (!requireAdmin(req, res)) return;
    const jobs = db
      .prepare(
        `SELECT j.id, j.signal_id, j.device_id, j.user_id, j.status, j.reason, j.attempts,
                j.kind, j.revision, j.last_error, j.created_at, j.sent_at, j.delivered_at,
                s.symbol AS symbol, s.action AS action
         FROM delivery_jobs j LEFT JOIN signals s ON s.id = j.signal_id
         ORDER BY j.id DESC LIMIT 100`,
      )
      .all();
    const hooks = db
      .prepare('SELECT * FROM webhook_events ORDER BY id DESC LIMIT 50')
      .all();
    sendJson(res, 200, { deliveries: jobs, webhookEvents: hooks });
    return;
  }

  if (method === 'GET' && path === '/api/admin/settings') {
    if (!requireAdmin(req, res)) return;
    const s = allSettings();
    delete s.admin_password_hash;
    sendJson(res, 200, { settings: s });
    return;
  }

  if (method === 'POST' && path === '/api/admin/settings') {
    if (!requireAdmin(req, res)) return;
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: 'invalid json body' });
      return;
    }
    const allowed = [
      'free_visible_count',
      'history_days',
      'telegram_url',
      'website_url',
      'instagram_url',
      'support_email',
    ];
    for (const key of allowed) {
      if (body[key] !== undefined) setSetting(key, String(body[key]).slice(0, 300));
    }
    const s = allSettings();
    delete s.admin_password_hash;
    sendJson(res, 200, { settings: s });
    return;
  }

  sendJson(res, 404, { error: 'not found', path });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[http] unhandled error on', req.method, req.url, err);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal server error' });
    else res.end();
  });
});

const port = Number(process.env.PORT ?? 3001);
server.listen(port, () => {
  console.log(`[server] SignalDesk API listening on ${port}`);
  console.log(`[server] webhook secret ${process.env.TRADINGVIEW_WEBHOOK_SECRET ? 'loaded from env' : 'using built-in default — set TRADINGVIEW_WEBHOOK_SECRET'}`);
  console.log(`[server] admin user: ${getSetting('admin_username')}`);
});
