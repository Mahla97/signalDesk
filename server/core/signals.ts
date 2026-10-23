import { db } from '../lib/db.js';
import { getSettingNumber } from './schema.js';
import { nowIso, sha1, startOfUtcDayIso, toNumber, toStr } from './util.js';

export type SignalRow = {
  id: number;
  external_signal_id: string;
  strategy_name: string;
  symbol: string;
  market: string;
  action: string;
  price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  take_profits: string | null;
  timeframe: string | null;
  status: string;
  result: string | null;
  close_price: number | null;
  closed_at: string | null;
  pnl_percent: number | null;
  note: string | null;
  is_sample: number;
  edited_at: string | null;
  edit_count: number;
  signal_timestamp: string;
  received_at: string;
  created_at: string;
  deleted_at: string | null;
};

export type SignalChange = {
  revision: number;
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

export type PublicSignal = {
  id: number;
  externalSignalId: string | null;
  strategyName: string | null;
  symbol: string | null;
  market: string | null;
  action: string | null;
  price: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfits: number[];
  timeframe: string | null;
  status: string;
  result: string | null;
  closePrice: number | null;
  closedAt: string | null;
  pnlPercent: number | null;
  note: string | null;
  isSample: boolean;
  editedAt: string | null;
  editCount: number;
  signalTimestamp: string;
  receivedAt: string;
  locked: boolean;
  changes?: SignalChange[];
};

export const ALLOWED_ACTIONS = ['BUY', 'SELL', 'CLOSE'] as const;
const MAX_TAKE_PROFITS = 8;

export type WebhookResult =
  | { ok: true; created: boolean; signal: SignalRow }
  | { ok: false; error: string };

/* ------------------------------ take profits ------------------------------ */

/** Accepts arrays, comma separated strings and tp1..tpN keys — always returns clean numbers. */
export function normaliseTakeProfits(value: unknown): number[] {
  let raw: unknown[] = [];
  if (Array.isArray(value)) raw = value;
  else if (typeof value === 'string') raw = value.split(/[,;|\s]+/);
  else if (value !== null && value !== undefined) raw = [value];

  const out: number[] = [];
  for (const item of raw) {
    const n = toNumber(item);
    if (n === null || n <= 0) continue;
    if (!out.includes(n)) out.push(n);
    if (out.length >= MAX_TAKE_PROFITS) break;
  }
  return out;
}

function takeProfitsFromPayload(payload: Record<string, unknown>): number[] {
  const listed = normaliseTakeProfits(
    payload.takeProfits ?? payload.take_profits ?? payload.tps ?? payload.targets,
  );
  if (listed.length > 0) return listed;

  const numbered: unknown[] = [];
  for (let i = 1; i <= MAX_TAKE_PROFITS; i += 1) {
    const v = payload['tp' + i] ?? payload['takeProfit' + i] ?? payload['target' + i];
    if (v !== undefined && v !== null && v !== '') numbered.push(v);
  }
  if (numbered.length > 0) return normaliseTakeProfits(numbered);

  return normaliseTakeProfits(payload.takeProfit ?? payload.take_profit ?? payload.tp);
}

export function parseTakeProfits(row: SignalRow): number[] {
  if (row.take_profits) {
    try {
      const parsed = JSON.parse(row.take_profits) as unknown;
      const list = normaliseTakeProfits(parsed);
      if (list.length > 0) return list;
    } catch {
      /* fall through to the legacy single column */
    }
  }
  return row.take_profit !== null && row.take_profit !== undefined ? [row.take_profit] : [];
}

/* --------------------------------- ingest --------------------------------- */

/** Deterministic id so a repeated TradingView alert can never create a second row. */
export function deterministicId(payload: Record<string, unknown>): string {
  const explicit = toStr(payload.id ?? payload.signalId ?? payload.externalSignalId, 120);
  if (explicit) return explicit;
  const parts = [
    toStr(payload.strategy ?? payload.strategyName, 80) ?? '',
    toStr(payload.symbol ?? payload.ticker, 40) ?? '',
    toStr(payload.action ?? payload.side, 10) ?? '',
    toStr(payload.timeframe ?? payload.interval, 10) ?? '',
    toStr(payload.time ?? payload.timestamp ?? payload.signalTimestamp, 40) ?? '',
    String(toNumber(payload.price ?? payload.close) ?? ''),
  ].join('|');
  return 'auto-' + sha1(parts);
}

function parseTimestamp(value: unknown): string {
  const raw = toStr(value, 60);
  if (!raw) return nowIso();
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && raw.length >= 10 && !raw.includes('-')) {
    const ms = asNumber > 1e12 ? asNumber : asNumber * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return nowIso();
}

function guessMarket(symbol: string, explicit: string | null): string {
  if (explicit) return explicit.toUpperCase() === 'FOREX' ? 'FOREX' : 'CRYPTO';
  const s = symbol.toUpperCase();
  if (/USDT|USDC|BTC$|PERP|BUSD/.test(s)) return 'CRYPTO';
  if (/^(EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY|XAU|XAG)/.test(s)) return 'FOREX';
  return 'CRYPTO';
}

export function getSignalById(id: number): SignalRow | undefined {
  return db.prepare('SELECT * FROM signals WHERE id = ?').get(id) as SignalRow | undefined;
}

export function getSignalByExternalId(externalId: string): SignalRow | undefined {
  return db.prepare('SELECT * FROM signals WHERE external_signal_id = ? AND deleted_at IS NULL').get(externalId) as
    | SignalRow
    | undefined;
}

/**
 * Validate + persist a TradingView payload. Idempotent by external_signal_id.
 * Never sends anything itself — distribution is enqueued by the caller.
 */
export function ingestWebhookPayload(payload: Record<string, unknown>): WebhookResult {
  const symbol = toStr(payload.symbol ?? payload.ticker, 40);
  const actionRaw = toStr(payload.action ?? payload.side, 12);
  if (!symbol) return { ok: false, error: 'symbol is required' };
  if (!actionRaw) return { ok: false, error: 'action is required' };

  const action = actionRaw.toUpperCase();
  if (!ALLOWED_ACTIONS.includes(action as (typeof ALLOWED_ACTIONS)[number])) {
    return { ok: false, error: 'action must be one of BUY, SELL, CLOSE' };
  }

  const price = toNumber(payload.price ?? payload.close);
  if (price !== null && price <= 0) return { ok: false, error: 'price must be positive' };

  const externalId = deterministicId(payload);
  const existing = getSignalByExternalId(externalId);
  if (existing) return { ok: true, created: false, signal: existing };

  const strategyName = toStr(payload.strategy ?? payload.strategyName, 80) ?? 'Manual';
  const timeframe = toStr(payload.timeframe ?? payload.interval, 12);
  const stopLoss = toNumber(payload.stopLoss ?? payload.sl);
  const takeProfits = takeProfitsFromPayload(payload);
  const note = toStr(payload.note ?? payload.comment ?? payload.message, 500);
  const signalTimestamp = parseTimestamp(payload.time ?? payload.timestamp ?? payload.signalTimestamp);
  const market = guessMarket(symbol, toStr(payload.market, 20));
  const now = nowIso();

  if (action === 'CLOSE') {
    closeMatchingSignal(symbol.toUpperCase(), strategyName, price, toStr(payload.result, 12), now);
  }

  db.prepare(
    `INSERT INTO signals (
       external_signal_id, strategy_name, symbol, market, action, price, stop_loss, take_profit,
       take_profits, timeframe, status, note, is_sample, signal_timestamp, received_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    externalId,
    strategyName,
    symbol.toUpperCase(),
    market,
    action,
    price,
    stopLoss,
    takeProfits.length > 0 ? takeProfits[0] : null,
    takeProfits.length > 0 ? JSON.stringify(takeProfits) : null,
    timeframe,
    action === 'CLOSE' ? 'CLOSED' : 'OPEN',
    note,
    signalTimestamp,
    now,
    now,
  );

  const created = getSignalByExternalId(externalId) as SignalRow;
  if (action === 'CLOSE') {
    db.prepare('UPDATE signals SET closed_at = ?, close_price = ? WHERE id = ?').run(
      now,
      price,
      created.id,
    );
  }
  return { ok: true, created: true, signal: getSignalById(created.id) as SignalRow };
}

/* --------------------------------- closing -------------------------------- */

function computePnl(action: string, entry: number | null, closePrice: number | null): number | null {
  if (closePrice === null || entry === null || !entry) return null;
  const raw = ((closePrice - entry) / entry) * 100;
  return Number((action.toUpperCase() === 'SELL' ? -raw : raw).toFixed(2));
}

/** Closes one specific signal — used by the admin panel, where the row is known. */
export function closeSignalById(
  id: number,
  closePrice: number | null,
  result: string | null,
  when: string = nowIso(),
): SignalRow | undefined {
  const row = getSignalById(id);
  if (!row) return undefined;

  const pnl = computePnl(row.action, row.price, closePrice);
  let outcome = result ? result.toUpperCase().slice(0, 12) : null;
  if (!outcome && pnl !== null) outcome = pnl >= 0 ? 'TP' : 'SL';
  if (!outcome) outcome = 'MANUAL';

  db.prepare(
    `UPDATE signals SET status = 'CLOSED', closed_at = ?, close_price = ?, result = ?, pnl_percent = ?
     WHERE id = ?`,
  ).run(when, closePrice, outcome, pnl, id);
  console.log(`[signals] closed #${id} ${row.symbol} (${outcome})`);
  return getSignalById(id);
}

/** A CLOSE alert closes the newest matching OPEN entry and records its result. */
export function closeMatchingSignal(
  symbol: string,
  strategyName: string,
  closePrice: number | null,
  result: string | null,
  when: string,
): void {
  const open = db
    .prepare(
      `SELECT * FROM signals
       WHERE symbol = ? AND status = 'OPEN' AND action IN ('BUY','SELL') AND deleted_at IS NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(symbol) as SignalRow | undefined;
  if (!open) return;

  const pnl = computePnl(open.action, open.price, closePrice);
  let outcome = result ? result.toUpperCase() : null;
  if (!outcome && pnl !== null) outcome = pnl >= 0 ? 'TP' : 'SL';

  db.prepare(
    `UPDATE signals SET status = 'CLOSED', closed_at = ?, close_price = ?, result = ?, pnl_percent = ?
     WHERE id = ?`,
  ).run(when, closePrice, outcome, pnl, open.id);
  console.log(`[signals] closed #${open.id} ${symbol} via ${strategyName} (${outcome ?? 'n/a'})`);
}

/* --------------------------- editing after publish ------------------------- */

export type SignalPatch = {
  symbol?: string | null;
  action?: string | null;
  market?: string | null;
  price?: number | null;
  stopLoss?: number | null;
  takeProfits?: unknown;
  timeframe?: string | null;
  strategyName?: string | null;
  note?: string | null;
  status?: string | null;
  result?: string | null;
  closePrice?: number | null;
};

export type UpdateResult =
  | { ok: false; error: string }
  | { ok: true; signal: SignalRow; changes: SignalChange[]; revision: number };

const FIELD_LABELS: Record<string, string> = {
  symbol: 'Symbol',
  action: 'Action',
  market: 'Market',
  price: 'Entry price',
  stop_loss: 'Stop loss',
  take_profits: 'Take profit levels',
  timeframe: 'Timeframe',
  strategy_name: 'Strategy',
  note: 'Note',
  status: 'Status',
  result: 'Result',
  close_price: 'Close price',
};

function displayValue(column: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (column === 'take_profits') {
    const list = normaliseTakeProfits(typeof value === 'string' ? safeJson(value) : value);
    return list.length > 0 ? list.join(' / ') : null;
  }
  return String(value);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Applies an admin edit to an already published signal, writing one change-log
 * row per modified field and bumping the revision. Distribution of the
 * "signal updated" notice is the caller's job — same split as the webhook.
 */
export function updateSignal(id: number, patch: SignalPatch): UpdateResult {
  const row = getSignalById(id);
  if (!row) return { ok: false, error: 'signal not found' };

  const next: Record<string, string | number | null> = {};

  if (patch.symbol !== undefined) {
    const symbol = toStr(patch.symbol, 40);
    if (!symbol) return { ok: false, error: 'symbol cannot be empty' };
    next.symbol = symbol.toUpperCase();
  }
  if (patch.action !== undefined) {
    const action = (toStr(patch.action, 12) ?? '').toUpperCase();
    if (!ALLOWED_ACTIONS.includes(action as (typeof ALLOWED_ACTIONS)[number])) {
      return { ok: false, error: 'action must be one of BUY, SELL, CLOSE' };
    }
    next.action = action;
  }
  if (patch.market !== undefined) {
    const market = (toStr(patch.market, 20) ?? '').toUpperCase();
    next.market = market === 'FOREX' ? 'FOREX' : 'CRYPTO';
  }
  if (patch.price !== undefined) {
    const price = toNumber(patch.price);
    if (price !== null && price <= 0) return { ok: false, error: 'entry price must be positive' };
    next.price = price;
  }
  if (patch.stopLoss !== undefined) {
    const sl = toNumber(patch.stopLoss);
    if (sl !== null && sl <= 0) return { ok: false, error: 'stop loss must be positive' };
    next.stop_loss = sl;
  }
  if (patch.takeProfits !== undefined) {
    const tps = normaliseTakeProfits(patch.takeProfits);
    next.take_profits = tps.length > 0 ? JSON.stringify(tps) : null;
    next.take_profit = tps.length > 0 ? tps[0] : null;
  }
  if (patch.timeframe !== undefined) next.timeframe = toStr(patch.timeframe, 12);
  if (patch.strategyName !== undefined) next.strategy_name = toStr(patch.strategyName, 80) ?? 'Manual';
  if (patch.note !== undefined) next.note = toStr(patch.note, 500);
  if (patch.result !== undefined) {
    const result = toStr(patch.result, 12);
    next.result = result ? result.toUpperCase() : null;
  }
  if (patch.closePrice !== undefined) {
    const cp = toNumber(patch.closePrice);
    if (cp !== null && cp <= 0) return { ok: false, error: 'close price must be positive' };
    next.close_price = cp;
  }
  if (patch.status !== undefined) {
    const status = (toStr(patch.status, 10) ?? '').toUpperCase();
    if (status !== 'OPEN' && status !== 'CLOSED') {
      return { ok: false, error: 'status must be OPEN or CLOSED' };
    }
    next.status = status;
  }

  const now = nowIso();
  const finalStatus = (next.status as string | undefined) ?? row.status;
  const finalAction = (next.action as string | undefined) ?? row.action;
  const finalEntry = next.price !== undefined ? (next.price as number | null) : row.price;
  const finalClose = next.close_price !== undefined ? (next.close_price as number | null) : row.close_price;

  if (finalStatus === 'CLOSED') {
    if (!row.closed_at) next.closed_at = now;
    next.pnl_percent = computePnl(finalAction, finalEntry, finalClose);
    if (!next.result && !row.result) {
      const pnl = next.pnl_percent as number | null;
      next.result = pnl === null ? 'MANUAL' : pnl >= 0 ? 'TP' : 'SL';
    }
  } else {
    // Re-opening a signal clears everything that only makes sense once closed.
    next.closed_at = null;
    next.close_price = null;
    next.pnl_percent = null;
    next.result = null;
  }

  const changes: { column: string; oldValue: string | null; newValue: string | null }[] = [];
  for (const column of Object.keys(FIELD_LABELS)) {
    if (!(column in next)) continue;
    const before = displayValue(column, (row as unknown as Record<string, unknown>)[column]);
    const after = displayValue(column, next[column]);
    if (before !== after) changes.push({ column, oldValue: before, newValue: after });
  }

  const revision = changes.length > 0 ? row.edit_count + 1 : row.edit_count;
  if (changes.length > 0) {
    next.edited_at = now;
    next.edit_count = revision;
  }

  const columns = Object.keys(next);
  if (columns.length === 0) {
    return { ok: true, signal: row, changes: [], revision: row.edit_count };
  }

  try {
    const sql = 'UPDATE signals SET ' + columns.map((c) => c + ' = ?').join(', ') + ' WHERE id = ?';
    db.prepare(sql).run(...columns.map((c) => next[c]), id);
  } catch (err) {
    console.error('[signals] update failed for signal', id, err);
    return { ok: false, error: 'could not save the changes' };
  }

  const logged: SignalChange[] = [];
  if (changes.length > 0) {
    const insert = db.prepare(
      `INSERT INTO signal_edits (signal_id, revision, field, label, old_value, new_value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const change of changes) {
      insert.run(id, revision, change.column, FIELD_LABELS[change.column], change.oldValue, change.newValue, now);
      logged.push({
        revision,
        field: change.column,
        label: FIELD_LABELS[change.column],
        oldValue: change.oldValue,
        newValue: change.newValue,
        createdAt: now,
      });
    }
    console.log(
      `[signals] edited #${id} ${row.symbol} rev ${revision}: ` +
        logged.map((c) => `${c.field} ${c.oldValue ?? '—'}→${c.newValue ?? '—'}`).join(', '),
    );
  }

  return { ok: true, signal: getSignalById(id) as SignalRow, changes: logged, revision };
}

export function listSignalChanges(signalId: number, revision?: number): SignalChange[] {
  const rows =
    revision === undefined
      ? (db
          .prepare(
            'SELECT revision, field, label, old_value, new_value, created_at FROM signal_edits WHERE signal_id = ? ORDER BY revision DESC, id ASC LIMIT 60',
          )
          .all(signalId) as Record<string, unknown>[])
      : (db
          .prepare(
            'SELECT revision, field, label, old_value, new_value, created_at FROM signal_edits WHERE signal_id = ? AND revision = ? ORDER BY id ASC',
          )
          .all(signalId, revision) as Record<string, unknown>[]);

  return rows.map((r) => ({
    revision: Number(r.revision),
    field: String(r.field),
    label: String(r.label),
    oldValue: (r.old_value as string | null) ?? null,
    newValue: (r.new_value as string | null) ?? null,
    createdAt: String(r.created_at),
  }));
}

/** Short human sentence used as the body of an "updated signal" notification. */
export function changeSummary(changes: SignalChange[]): string {
  if (changes.length === 0) return 'Details were updated.';
  return changes
    .slice(0, 3)
    .map((c) => `${c.label}: ${c.oldValue ?? '—'} → ${c.newValue ?? '—'}`)
    .join(' · ');
}

/* ------------------------------ read side -------------------------------- */

function redact(row: SignalRow, locked: boolean): PublicSignal {
  if (locked) {
    return {
      id: row.id,
      externalSignalId: null,
      strategyName: null,
      symbol: null,
      market: row.market,
      action: null,
      price: null,
      stopLoss: null,
      takeProfit: null,
      takeProfits: [],
      timeframe: row.timeframe,
      status: row.status,
      result: null,
      closePrice: null,
      closedAt: null,
      pnlPercent: null,
      note: null,
      isSample: Boolean(row.is_sample),
      editedAt: row.edited_at,
      editCount: row.edit_count ?? 0,
      signalTimestamp: row.signal_timestamp,
      receivedAt: row.received_at,
      locked: true,
    };
  }
  const takeProfits = parseTakeProfits(row);
  return {
    id: row.id,
    externalSignalId: row.external_signal_id,
    strategyName: row.strategy_name,
    symbol: row.symbol,
    market: row.market,
    action: row.action,
    price: row.price,
    stopLoss: row.stop_loss,
    takeProfit: takeProfits.length > 0 ? takeProfits[0] : row.take_profit,
    takeProfits,
    timeframe: row.timeframe,
    status: row.status,
    result: row.result,
    closePrice: row.close_price,
    closedAt: row.closed_at,
    pnlPercent: row.pnl_percent,
    note: row.note,
    isSample: Boolean(row.is_sample),
    editedAt: row.edited_at,
    editCount: row.edit_count ?? 0,
    signalTimestamp: row.signal_timestamp,
    receivedAt: row.received_at,
    locked: false,
  };
}

/** Ids a free viewer may read in full: the first N open signals of the current day. */
export function unlockedOpenIds(): Set<number> {
  const limit = getSettingNumber('free_visible_count', 3);
  const rows = db
    .prepare(
      `SELECT id FROM signals
       WHERE status = 'OPEN' AND deleted_at IS NULL AND signal_timestamp >= ?
       ORDER BY signal_timestamp ASC, id ASC LIMIT ?`,
    )
    .all(startOfUtcDayIso(), limit) as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * Whether a single signal falls inside the free "first N of today" window.
 * Unlike unlockedOpenIds() it ignores the signal's own deleted/status state, so
 * it also answers correctly for a soft-deleted signal (DELETE notification).
 */
export function isSignalInFreeWindow(signal: SignalRow): boolean {
  const limit = getSettingNumber('free_visible_count', 3);
  const since = startOfUtcDayIso();
  const ts = signal.signal_timestamp;
  if (!ts || ts < since) return false;
  const earlier = db
    .prepare(
      `SELECT COUNT(*) AS c FROM signals
       WHERE status = 'OPEN' AND deleted_at IS NULL AND signal_timestamp >= ?
         AND (signal_timestamp < ? OR (signal_timestamp = ? AND id < ?))`,
    )
    .get(since, ts, ts, signal.id) as { c: number };
  return earlier.c < limit;
}

export function isLockedFor(row: SignalRow, isPro: boolean, unlocked?: Set<number>): boolean {
  if (isPro) return false;
  if (row.status === 'CLOSED') return false; // history is open to everyone
  const set = unlocked ?? unlockedOpenIds();
  return !set.has(row.id);
}

export type ListOptions = {
  status?: 'open' | 'closed' | 'all';
  statusExact?: 'OPEN' | 'CLOSED' | 'DRAFT' | null;
  market?: string | null;
  action?: string | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  page: number;
  pageSize: number;
  isPro: boolean;
};

export function listSignals(opts: ListOptions): {
  items: PublicSignal[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
} {
  const page = Math.max(1, Math.floor(opts.page));
  const pageSize = Math.min(50, Math.max(1, Math.floor(opts.pageSize)));
  const conds: string[] = [];
  const params: (string | number)[] = [];

  conds.push('deleted_at IS NULL');

  if (opts.statusExact) {
    conds.push('status = ?');
    params.push(opts.statusExact);
  } else if (opts.status === 'open') {
    conds.push("status = 'OPEN'");
  } else if (opts.status === 'closed') {
    const days = getSettingNumber('history_days', 14);
    conds.push("status = 'CLOSED'");
    conds.push('COALESCE(closed_at, signal_timestamp) >= ?');
    params.push(new Date(Date.now() - days * 86400000).toISOString());
  }
  if (opts.action) {
    conds.push('action = ?');
    params.push(opts.action.toUpperCase());
  }
  if (opts.timeFrom) {
    conds.push('signal_timestamp >= ?');
    params.push(opts.timeFrom);
  }
  if (opts.timeTo) {
    conds.push('signal_timestamp <= ?');
    params.push(opts.timeTo);
  }
  if (opts.market) {
    conds.push('market = ?');
    params.push(opts.market.toUpperCase());
  }

  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  const totalRow = db
    .prepare('SELECT COUNT(*) AS c FROM signals' + where)
    .get(...params) as { c: number };

  const rows = db
    .prepare(
      'SELECT * FROM signals' +
        where +
        ' ORDER BY signal_timestamp DESC, id DESC LIMIT ? OFFSET ?',
    )
    .all(...params, pageSize, (page - 1) * pageSize) as SignalRow[];

  const unlocked = unlockedOpenIds();
  const items = rows.map((row) => redact(row, isLockedFor(row, opts.isPro, unlocked)));
  return {
    items,
    page,
    pageSize,
    total: totalRow.c,
    hasMore: page * pageSize < totalRow.c,
  };
}

export function publicSignal(row: SignalRow, isPro: boolean): PublicSignal {
  return redact(row, isLockedFor(row, isPro));
}

export function rawPublicSignal(row: SignalRow): PublicSignal {
  return redact(row, false);
}

export function deleteSignal(id: number): SignalRow | undefined {
  const row = getSignalById(id);
  if (!row || row.deleted_at) return undefined;
  db.prepare('UPDATE signals SET deleted_at = ? WHERE id = ?').run(nowIso(), id);
  return row;
}

/** Publishes a draft: DRAFT → OPEN, timestamped now so it lands at the top of the feed. */
export function publishSignal(id: number): SignalRow | undefined {
  const row = getSignalById(id);
  if (!row || row.deleted_at || row.status !== 'DRAFT') return undefined;
  db.prepare("UPDATE signals SET status = 'OPEN', signal_timestamp = ? WHERE id = ?").run(nowIso(), id);
  return getSignalById(id);
}

export function deleteSampleSignals(): number {
  const res = db.prepare('DELETE FROM signals WHERE is_sample = 1').run();
  return Number(res.changes ?? 0);
}

export function performanceStats(): { total: number; wins: number; losses: number; winRate: number } {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN result = 'TP' OR pnl_percent > 0 THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN result = 'SL' OR pnl_percent < 0 THEN 1 ELSE 0 END) AS losses
       FROM signals WHERE status = 'CLOSED' AND deleted_at IS NULL`,
    )
    .get() as { total: number; wins: number | null; losses: number | null };
  const total = row.total ?? 0;
  const wins = row.wins ?? 0;
  const losses = row.losses ?? 0;
  return {
    total,
    wins,
    losses,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
  };
}
