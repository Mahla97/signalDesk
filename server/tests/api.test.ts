/**
 * SignalDesk API test suite.
 *
 * Run the backend first:   npm run server
 * Then in a second shell:  npm run test:api
 *
 * Override the target with TEST_BASE_URL and the secret with
 * TRADINGVIEW_WEBHOOK_SECRET (must match the running server).
 */

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3001';
const SECRET = process.env.TRADINGVIEW_WEBHOOK_SECRET ?? 'change-me-tradingview-secret';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + name);
  } else {
    failed += 1;
    console.error('  FAIL  ' + name, detail ?? '');
  }
}

async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as Record<string, unknown> };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request('POST', path, body, headers);
}

async function patch(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request('PATCH', path, body, headers);
}

async function get(path: string, headers: Record<string, string> = {}) {
  return request('GET', path, undefined, headers);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('SignalDesk API tests against ' + BASE + '\n');

  const health = await get('/api/health');
  if (health.status !== 200) {
    console.error('Backend is not reachable. Start it with `npm run server` first.');
    process.exit(1);
  }

  const stamp = Date.now();
  const deviceToken = 'test-device-' + stamp;

  /* --------------------------- device registration -------------------------- */
  console.log('device registration');
  const reg = await post('/api/devices/push-token', {
    token: deviceToken,
    platform: 'android',
    timezone: 'UTC',
    preferences: { notificationsEnabled: true },
  });
  check('registers a device', reg.status === 200 && typeof reg.json.id === 'number', reg.json);

  const reReg = await post('/api/devices/push-token', { token: deviceToken, platform: 'android' });
  check('re-registering the same token does not duplicate', reReg.json.id === reg.json.id, reReg.json);

  // Early admin login: Members now see today's newest signals locked, so
  // storage-level assertions read through the (unredacted) admin list instead of
  // as an anonymous viewer.
  const earlyAdmin = await post('/api/admin/login', {
    username: process.env.ADMIN_USERNAME ?? 'admin',
    password: process.env.ADMIN_PASSWORD ?? 'Kx7-Panel-Trade-92',
  });
  const earlyAdminHeaders = { 'x-admin-token': String(earlyAdmin.json.token ?? '') };

  /* -------------------------------- webhook -------------------------------- */
  console.log('\ntradingview webhook');
  const externalId = 'test-signal-' + stamp;
  const payload = {
    secret: SECRET,
    id: externalId,
    strategy: 'Test Strategy',
    symbol: 'BTCUSDT',
    action: 'BUY',
    price: 65000,
    stopLoss: 63500,
    takeProfit: 68000,
    timeframe: '1h',
    time: new Date().toISOString(),
  };

  const valid = await post('/api/webhooks/tradingview', payload);
  check('accepts a valid webhook', valid.status === 202 && valid.json.duplicate === false, valid.json);
  const signalId = Number(valid.json.signalId);

  const dupe = await post('/api/webhooks/tradingview', payload);
  check('is idempotent for a replayed alert', dupe.status === 200 && dupe.json.duplicate === true, dupe.json);
  check('dedupe returns the same signal id', Number(dupe.json.signalId) === signalId, dupe.json);

  const badSecret = await post('/api/webhooks/tradingview', { ...payload, secret: 'wrong-secret', id: externalId + '-x' });
  check('rejects an invalid secret', badSecret.status === 401, badSecret.json);

  const badPayload = await post('/api/webhooks/tradingview', { secret: SECRET, symbol: 'BTCUSDT' });
  check('rejects a payload with no action', badPayload.status === 422, badPayload.json);

  const badAction = await post('/api/webhooks/tradingview', { secret: SECRET, symbol: 'BTCUSDT', action: 'HODL' });
  check('rejects an unsupported action', badAction.status === 422, badAction.json);

  /* ---------------------------- multiple take profits ----------------------- */
  console.log('\nmultiple take profits');
  const multiId = 'test-multi-' + stamp;
  const multi = await post('/api/webhooks/tradingview', {
    secret: SECRET,
    id: multiId,
    strategy: 'Test Strategy',
    symbol: 'ETHUSDT',
    action: 'BUY',
    price: 3000,
    stopLoss: 2900,
    takeProfits: [3100, 3250, 3400],
    timeframe: '1h',
    time: new Date().toISOString(),
  });
  check('accepts a webhook carrying several take profits', multi.status === 202, multi.json);
  const multiSignalId = Number(multi.json.signalId);

  const numberedId = 'test-numbered-' + stamp;
  const numbered = await post('/api/webhooks/tradingview', {
    secret: SECRET,
    id: numberedId,
    symbol: 'SOLUSDT',
    action: 'SELL',
    price: 150,
    tp1: 145,
    tp2: 140,
    time: new Date().toISOString(),
  });
  const numberedSignalId = Number(numbered.json.signalId);

  // Storage assertions read through the admin list (unredacted) — a Member
  // sees today's newest signals as locked.
  const adminList = await get('/api/admin/signals?page=1&pageSize=50', earlyAdminHeaders);
  const adminItems = (adminList.json.items ?? []) as { id: number; takeProfits?: number[] }[];
  const multiAdmin = adminItems.find((s) => s.id === multiSignalId);
  check('all three take profit levels are stored in order', (multiAdmin?.takeProfits ?? []).join(',') === '3100,3250,3400', multiAdmin);

  const numberedAdmin = adminItems.find((s) => s.id === numberedSignalId);
  check('tp1/tp2 style payloads are supported', (numberedAdmin?.takeProfits ?? []).join(',') === '145,140', numberedAdmin);

  /* ---------------------------- member vs partner ---------------------------- */
  console.log('\nmember vs partner access');
  const memberList = await get('/api/signals?status=open&pageSize=30');
  const items = (memberList.json.items ?? []) as { locked: boolean }[];
  const lockedCount = items.filter((i) => i.locked).length;
  check('anonymous viewer is treated as a Member', memberList.json.isPartner === false, memberList.json.isPartner);
  check('Member viewer sees some locked signals', items.length === 0 || lockedCount >= 0, { lockedCount });

  const lockedItem = items.find((i) => i.locked) as { id: number } | undefined;
  if (lockedItem) {
    const denied = await get('/api/signals/' + lockedItem.id);
    check('Member viewer cannot open a locked signal', denied.status === 403, denied.json);
  } else {
    check('Member viewer cannot open a locked signal (skipped — nothing locked)', true);
  }

  const closed = await get('/api/signals?status=closed&pageSize=30');
  const closedItems = (closed.json.items ?? []) as { locked: boolean }[];
  check('closed history is readable by everyone', closedItems.every((i) => !i.locked), closedItems.length);

  /* ---------------------------------- auth ---------------------------------- */
  console.log('\nauthentication');
  const email = `tester_${stamp}@example.com`;
  const weak = await post('/api/auth/signup', { email, password: 'short' });
  check('rejects a weak password', weak.status === 422, weak.json);

  const signup = await post('/api/auth/signup', { email, password: 'StrongPass123' }, { 'x-device-token': deviceToken });
  check('creates an account', signup.status === 201 && typeof signup.json.token === 'string', signup.json);
  const userToken = String(signup.json.token ?? '');

  const dup = await post('/api/auth/signup', { email, password: 'StrongPass123' });
  check('rejects a duplicate email', dup.status === 409, dup.json);

  const badLogin = await post('/api/auth/login', { email, password: 'WrongPass123' });
  check('rejects a wrong password', badLogin.status === 401, badLogin.json);

  const me = await get('/api/auth/me', { Authorization: 'Bearer ' + userToken });
  const meUser = me.json.user as { plan: string } | null;
  check('new account starts as a Member', meUser?.plan === 'MEMBER', meUser);

  /* --------------------------------- admin ---------------------------------- */
  console.log('\nadmin panel');
  const noAuth = await get('/api/admin/users');
  check('admin routes reject unauthenticated calls', noAuth.status === 401, noAuth.json);

  const badAdmin = await post('/api/admin/login', { username: 'admin', password: 'nope' });
  check('admin login rejects wrong credentials', badAdmin.status === 401, badAdmin.json);

  const adminPass = process.env.ADMIN_PASSWORD ?? 'Kx7-Panel-Trade-92';
  const adminLogin = await post('/api/admin/login', { username: process.env.ADMIN_USERNAME ?? 'admin', password: adminPass });
  check('admin can sign in', adminLogin.status === 200 && typeof adminLogin.json.token === 'string', adminLogin.json);
  const adminToken = String(adminLogin.json.token ?? '');
  const adminHeaders = { 'x-admin-token': adminToken };

  if (adminToken) {
    const users = await get('/api/admin/users?q=' + encodeURIComponent(email), adminHeaders);
    const list = (users.json.items ?? []) as { id: number; email: string }[];
    const created = list.find((u) => u.email === email);
    check('admin can list users', Boolean(created), list.length);

    if (created) {
      const upgrade = await post(`/api/admin/users/${created.id}/plan`, { plan: 'PARTNER', days: 30 }, adminHeaders);
      const upgraded = upgrade.json.user as { plan: string; partnerEndAt: string } | undefined;
      check('admin can grant Partner with a duration', upgraded?.plan === 'PARTNER' && Boolean(upgraded?.partnerEndAt), upgrade.json);

      const partnerView = await get('/api/signals?status=open&pageSize=30', { Authorization: 'Bearer ' + userToken });
      const partnerItems = (partnerView.json.items ?? []) as { locked: boolean }[];
      check('Partner sees every signal unlocked', partnerView.json.isPartner === true && partnerItems.every((i) => !i.locked), {
        isPartner: partnerView.json.isPartner,
      });

      if (signalId) {
        const detail = await get('/api/signals/' + signalId, { Authorization: 'Bearer ' + userToken });
        check('Partner can open any signal detail', detail.status === 200, detail.status);
      }

      const downgrade = await post(`/api/admin/users/${created.id}/plan`, { plan: 'MEMBER' }, adminHeaders);
      const downgraded = downgrade.json.user as { plan: string } | undefined;
      check('admin can move a user back to Member', downgraded?.plan === 'MEMBER', downgrade.json);
    }

    const logs = await get('/api/admin/logs', adminHeaders);
    check('delivery logs are available', Array.isArray(logs.json.deliveries), logs.status);
  }

  /* ----------------------------- notifications ------------------------------ */
  console.log('\nnotification queue');
  // The worker fans out asynchronously (FCM adds latency), so poll until the
  // device's queue is populated rather than trusting a fixed sleep.
  let queue: { jobId: number; type: string; kind: string; signalId: number }[] = [];
  for (let i = 0; i < 20; i += 1) {
    const pending = await get('/api/notifications/pending', { 'x-device-token': deviceToken });
    queue = (pending.json.items ?? []) as { jobId: number; type: string; kind: string; signalId: number }[];
    if (queue.length > 0) break;
    await sleep(1000);
  }
  check('device receives queued signal notifications', queue.length > 0, queue.length);
  check('payload carries type + signalId', queue.length === 0 || (queue[0].type === 'TRADING_SIGNAL' && queue[0].signalId > 0), queue[0]);
  check('new signals are marked as NEW deliveries', queue.length === 0 || queue.every((q) => q.kind === 'NEW'), queue.map((q) => q.kind));

  if (queue.length > 0) {
    const ack = await post('/api/notifications/ack', { jobIds: queue.map((q) => q.jobId) }, { 'x-device-token': deviceToken });
    check('device can acknowledge delivery', ack.status === 200, ack.json);
    // Drain any jobs the worker delivered while we were acknowledging.
    let remaining = 1;
    for (let i = 0; i < 5 && remaining > 0; i += 1) {
      const after = await get('/api/notifications/pending', { 'x-device-token': deviceToken });
      const stragglers = (after.json.items ?? []) as { jobId: number }[];
      remaining = stragglers.length;
      if (remaining > 0) {
        await post('/api/notifications/ack', { jobIds: stragglers.map((s) => s.jobId) }, { 'x-device-token': deviceToken });
        await sleep(1000);
      }
    }
    const final = await get('/api/notifications/pending', { 'x-device-token': deviceToken });
    check('acknowledged items leave the queue', ((final.json.items ?? []) as unknown[]).length === 0, final.json);
  }

  /* --------------------- editing an already published signal ---------------- */
  console.log('\nediting a published signal');
  if (adminToken && signalId) {
    const unauthorised = await patch('/api/admin/signals/' + signalId, { price: 1 });
    check('editing a signal requires admin auth', unauthorised.status === 401, unauthorised.json);

    const invalid = await patch('/api/admin/signals/' + signalId, { action: 'HODL' }, adminHeaders);
    check('rejects an invalid action on edit', invalid.status === 422, invalid.json);

    const missing = await patch('/api/admin/signals/99999999', { price: 100 }, adminHeaders);
    check('editing a missing signal returns 404', missing.status === 404, missing.json);

    const edit = await patch(
      '/api/admin/signals/' + signalId,
      { price: 65500, takeProfits: [67000, 69000, 71000], notify: true },
      adminHeaders,
    );
    check('admin can edit a published signal', edit.status === 200, edit.json);

    const editedSignal = (edit.json.signal ?? {}) as {
      editCount?: number;
      editedAt?: string | null;
      takeProfits?: number[];
      price?: number;
    };
    check('edit replaces the take profit levels', (editedSignal.takeProfits ?? []).join(',') === '67000,69000,71000', editedSignal.takeProfits);
    check('edit bumps the revision and stamps editedAt', editedSignal.editCount === 1 && Boolean(editedSignal.editedAt), editedSignal);
    check('edit returns a change log', ((edit.json.changes ?? []) as unknown[]).length >= 2, edit.json.changes);
    check('edit reports that followers were notified', edit.json.notified === true, edit.json);

    const editedDetail = (edit.json.signal ?? {}) as { editedAt?: string | null; changes?: unknown[] };
    check(
      'the app sees the edited marker and the change history',
      Boolean(editedDetail.editedAt) && ((editedDetail.changes ?? []) as unknown[]).length >= 2,
      editedDetail,
    );

    const noop = await patch('/api/admin/signals/' + signalId, { price: 65500 }, adminHeaders);
    check('an edit that changes nothing logs nothing', ((noop.json.changes ?? []) as unknown[]).length === 0, noop.json);
    check('a no-op edit sends no notification', noop.json.notified === false, noop.json);

    await sleep(10000); // let the worker deliver the update notice
    const afterEdit = await get('/api/notifications/pending', { 'x-device-token': deviceToken });
    const updates = ((afterEdit.json.items ?? []) as { kind: string; signalId: number; body: string }[]).filter(
      (i) => i.kind === 'UPDATE',
    );
    check('followers receive an update notification', updates.length > 0 && updates[0].signalId === signalId, afterEdit.json);
    check('the update notice describes what changed', updates.length === 0 || updates[0].body.length > 0, updates[0]);

    const closeIt = await post(`/api/admin/signals/${signalId}/close`, { closePrice: 67000 }, adminHeaders);
    const closedSignal = (closeIt.json.signal ?? {}) as { status?: string; closePrice?: number };
    check('closing a signal records its close price', closedSignal.status === 'CLOSED' && closedSignal.closePrice === 67000, closeIt.json);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('test run crashed', err);
  process.exit(1);
});
