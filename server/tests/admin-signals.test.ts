/**
 * Admin signal lifecycle: add / edit / delete.
 *
 * Verifies the server-side contract that drives instant device updates: each
 * admin action fans out a delivery job of the right kind (NEW / UPDATE /
 * DELETE), so a client can refresh its feed without user interaction. The
 * client-side "reload on push" behaviour is exercised separately against the
 * app (see the FCM end-to-end check); this suite proves the notification the
 * client reacts to is actually produced.
 *
 * Run the backend first:   npm run server
 * Then:                    npm run test:admin
 */

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3001';

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

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as Record<string, unknown> };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  request('POST', path, body, headers);
const patch = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  request('PATCH', path, body, headers);
const get = (path: string, headers: Record<string, string> = {}) => request('GET', path, undefined, headers);
const del = (path: string, headers: Record<string, string> = {}) => request('DELETE', path, undefined, headers);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polls the device's pending queue until a notification matching `predicate`
 * shows up (the worker fans out asynchronously), then acknowledges it. Returns
 * the matched notification or undefined on timeout.
 */
async function waitForNotification(
  deviceToken: string,
  predicate: (n: Record<string, unknown>) => boolean,
  timeoutMs = 20000,
): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await get('/api/notifications/pending', { 'x-device-token': deviceToken });
    const items = (res.json.items ?? []) as Record<string, unknown>[];
    const found = items.find(predicate);
    if (found) {
      await post('/api/notifications/ack', { jobIds: [found.jobId] }, { 'x-device-token': deviceToken });
      return found;
    }
    await sleep(1000);
  }
  return undefined;
}

async function main(): Promise<void> {
  console.log('SignalDesk admin-signals tests against ' + BASE + '\n');

  const health = await get('/api/health');
  if (health.status !== 200) {
    console.error('Backend is not reachable. Start it with `npm run server` first.');
    process.exit(1);
  }

  const stamp = Date.now();
  const deviceToken = 'admin-test-device-' + stamp;

  console.log('setup');
  await post('/api/devices/push-token', {
    token: deviceToken,
    platform: 'android',
    timezone: 'UTC',
    preferences: {
      notificationsEnabled: true,
      tradingSignalsEnabled: true,
      buySignalsEnabled: true,
      sellSignalsEnabled: true,
    },
  });

  const adminPass = process.env.ADMIN_PASSWORD ?? 'Kx7-Panel-Trade-92';
  const login = await post('/api/admin/login', {
    username: process.env.ADMIN_USERNAME ?? 'admin',
    password: adminPass,
  });
  check('admin can sign in', login.status === 200 && typeof login.json.token === 'string', login.json);
  const adminHeaders = { 'x-admin-token': String(login.json.token ?? '') };

  /* --------------------------------- ADD ---------------------------------- */
  console.log('\n1) ADD a signal from the admin panel');
  const add = await post(
    '/api/admin/signals',
    {
      id: 'admin-add-' + stamp,
      symbol: 'BTCUSDT',
      action: 'BUY',
      price: 65000,
      stopLoss: 63000,
      takeProfits: [66000, 67000],
      timeframe: '1h',
      strategy: 'Admin lifecycle test',
    },
    adminHeaders,
  );
  check('admin can create a signal', add.status === 201, add.json);
  const signalId = Number(((add.json.signal ?? {}) as { id?: number }).id ?? 0);
  check('new signal has an id', signalId > 0, add.json);

  const newNote = await waitForNotification(deviceToken, (n) => n.kind === 'NEW' && n.signalId === signalId);
  check('device is notified of the new signal', Boolean(newNote), newNote);
  check('the notification is typed as NEW', newNote?.kind === 'NEW', newNote);

  /* -------------------------------- EDIT ---------------------------------- */
  console.log('\n2) EDIT a signal from the admin panel');
  const edit = await patch('/api/admin/signals/' + signalId, { price: 65500, notify: true }, adminHeaders);
  check('admin can edit a signal', edit.status === 200, edit.json);
  check('edit bumps the revision', Number(edit.json.revision ?? 0) >= 1, edit.json);

  const updateNote = await waitForNotification(deviceToken, (n) => n.kind === 'UPDATE' && n.signalId === signalId);
  check('device is notified of the edit', Boolean(updateNote), updateNote);
  check('the notification is typed as UPDATE', updateNote?.kind === 'UPDATE', updateNote);

  /* ------------------------------- DELETE --------------------------------- */
  console.log('\n3) DELETE a signal from the admin panel');
  const delRes = await del('/api/admin/signals/' + signalId, adminHeaders);
  check('admin can delete a signal', delRes.status === 200, delRes.json);

  const detail = await get('/api/signals/' + signalId);
  check('deleted signal is no longer readable', detail.status === 404, detail.json);

  const list = await get('/api/signals?status=open&pageSize=50');
  const items = (list.json.items ?? []) as { id: number }[];
  check('deleted signal is gone from the feed', !items.some((i) => i.id === signalId), { signalId });

  const deleteNote = await waitForNotification(deviceToken, (n) => n.kind === 'DELETE' && n.signalId === signalId);
  check('device is notified of the deletion', Boolean(deleteNote), deleteNote);
  check('the notification is typed as DELETE', deleteNote?.kind === 'DELETE', deleteNote);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('test run crashed', err);
  process.exit(1);
});
