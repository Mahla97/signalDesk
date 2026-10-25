import { db, migrate } from '../lib/db.js';
import { hashPassword, nowIso, sha1 } from './util.js';

/**
 * delivery_jobs is kept in its own constant because it is the one table that
 * needed a shape change after release (kind + revision, so an edited signal can
 * be re-delivered to the people who already had it). See migrateDeliveryJobs().
 */
const DELIVERY_JOBS_SQL = `
CREATE TABLE IF NOT EXISTS delivery_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  user_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'NEW',
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING',
  reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  delivered_at TEXT,
  UNIQUE (signal_id, device_id, revision, kind),
  FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_pending ON delivery_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_jobs_device ON delivery_jobs(device_id, status, created_at DESC);
`;

export const SCHEMA_SQL =
  `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'MEMBER',
  partner_status TEXT NOT NULL DEFAULT 'INACTIVE',
  partner_start_at TEXT,
  partner_end_at TEXT,
  suspended INTEGER NOT NULL DEFAULT 0,
  timezone TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_tokens (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  push_token TEXT,
  user_id INTEGER,
  platform TEXT NOT NULL DEFAULT 'android',
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  disabled INTEGER NOT NULL DEFAULT 0,
  timezone TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_signal_id TEXT NOT NULL UNIQUE,
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'CRYPTO',
  action TEXT NOT NULL,
  price REAL,
  stop_loss REAL,
  take_profit REAL,
  take_profits TEXT,
  timeframe TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  result TEXT,
  close_price REAL,
  closed_at TEXT,
  pnl_percent REAL,
  note TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0,
  edited_at TEXT,
  edit_count INTEGER NOT NULL DEFAULT 0,
  signal_timestamp TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_signals_external ON signals(external_signal_id);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(signal_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status, closed_at DESC);

CREATE TABLE IF NOT EXISTS signal_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  field TEXT NOT NULL,
  label TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_signal_edits_signal ON signal_edits(signal_id, revision DESC, id ASC);
` +
  DELIVERY_JOBS_SQL +
  `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const DEFAULT_SETTINGS: Record<string, string> = {
  member_visible_count: '3',
  history_days: '14',
  telegram_url: 'https://t.me/signaldesk',
  website_url: 'https://signaldesk.example.com',
  instagram_url: 'https://instagram.com/signaldesk',
  support_email: 'support@signaldesk.example.com',
  privacy_policy_url: 'https://signaldesk.example.com/privacy',
  announcement_enabled: '0',
  announcement_text: '',
};

export function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (row) return row.value;
  return DEFAULT_SETTINGS[key] ?? '';
}

export function getSettingNumber(key: string, fallback: number): number {
  const n = Number(getSetting(key));
  return Number.isFinite(n) ? n : fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function allSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/* ------------------------------- migrations ------------------------------- */

function tableColumns(table: string): string[] {
  try {
    const rows = db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[];
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

/** Adds a column to an existing install. No-op on a fresh database. */
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = tableColumns(table);
  if (cols.length === 0 || cols.includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(`[migrate] added ${table}.${column}`);
}

/**
 * The original delivery_jobs had UNIQUE(signal_id, device_id), which made a
 * second delivery for the same signal impossible. Editing a published signal
 * needs exactly that, so the table is rebuilt with the revision in the key.
 * Old rows are preserved as revision 0 / kind NEW.
 */
function migrateDeliveryJobs(): void {
  const cols = tableColumns('delivery_jobs');
  if (cols.length === 0 || cols.includes('revision')) return;
  try {
    db.exec('ALTER TABLE delivery_jobs RENAME TO delivery_jobs_old');
    db.exec('DROP INDEX IF EXISTS idx_jobs_pending');
    db.exec('DROP INDEX IF EXISTS idx_jobs_device');
    db.exec(DELIVERY_JOBS_SQL);
    db.exec(`
      INSERT INTO delivery_jobs
        (id, signal_id, device_id, user_id, kind, revision, status, reason, attempts,
         next_attempt_at, last_error, created_at, sent_at, delivered_at)
      SELECT id, signal_id, device_id, user_id, 'NEW', 0, status, reason, attempts,
             next_attempt_at, last_error, created_at, sent_at, delivered_at
      FROM delivery_jobs_old
    `);
    db.exec('DROP TABLE delivery_jobs_old');
    console.log('[migrate] rebuilt delivery_jobs with kind + revision');
  } catch (err) {
    console.error('[migrate] delivery_jobs rebuild failed', err);
  }
}

/**
 * The original UNIQUE(signal_id, device_id, revision) made a DELETE delivery
 * collide with the original NEW delivery (both revision 0). The key must include
 * kind so a signal's NEW, UPDATE and DELETE deliveries can coexist. Rebuild the
 * table when the old three-column key is still in place.
 */
function migrateDeliveryJobKindUnique(): void {
  const meta = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'delivery_jobs'")
    .get() as { sql: string } | undefined;
  if (!meta || !meta.sql.includes('UNIQUE (signal_id, device_id, revision)')) return;
  try {
    db.exec('ALTER TABLE delivery_jobs RENAME TO delivery_jobs_old');
    db.exec('DROP INDEX IF EXISTS idx_jobs_pending');
    db.exec('DROP INDEX IF EXISTS idx_jobs_device');
    db.exec(DELIVERY_JOBS_SQL);
    db.exec(`
      INSERT INTO delivery_jobs
        (id, signal_id, device_id, user_id, kind, revision, status, reason, attempts,
         next_attempt_at, last_error, created_at, sent_at, delivered_at)
      SELECT id, signal_id, device_id, user_id, kind, revision, status, reason, attempts,
             next_attempt_at, last_error, created_at, sent_at, delivered_at
      FROM delivery_jobs_old
    `);
    db.exec('DROP TABLE delivery_jobs_old');
    console.log('[migrate] rebuilt delivery_jobs with kind in the unique key');
  } catch (err) {
    console.error('[migrate] delivery_jobs uniqueness rebuild failed', err);
  }
}

/** Fills take_profits for rows written before multi-TP support existed. */
function backfillTakeProfits(): void {
  try {
    const rows = db
      .prepare('SELECT id, take_profit FROM signals WHERE take_profits IS NULL AND take_profit IS NOT NULL')
      .all() as { id: number; take_profit: number }[];
    if (rows.length === 0) return;
    const stmt = db.prepare('UPDATE signals SET take_profits = ? WHERE id = ?');
    for (const row of rows) stmt.run(JSON.stringify([row.take_profit]), row.id);
    console.log(`[migrate] backfilled take_profits for ${rows.length} signal(s)`);
  } catch (err) {
    console.error('[migrate] take_profits backfill failed', err);
  }
}

/**
 * Rename the old Free/Pro tier identifiers to the Member/Partner naming used
 * today. Column renames are idempotent (skip when the new column exists) and
 * the plan enum values are migrated in place.
 */
function migrateTierNames(): void {
  const cols = tableColumns('users');
  if (cols.length > 0) {
    const renames: [string, string][] = [
      ['pro_start_at', 'partner_start_at'],
      ['pro_end_at', 'partner_end_at'],
      ['subscription_status', 'partner_status'],
    ];
    for (const [from, to] of renames) {
      if (cols.includes(from) && !cols.includes(to)) {
        try {
          db.exec(`ALTER TABLE users RENAME COLUMN ${from} TO ${to}`);
          console.log(`[migrate] renamed users.${from} -> ${to}`);
        } catch (err) {
          console.error(`[migrate] failed to rename users.${from}`, err);
        }
      }
    }
  }
  db.prepare("UPDATE users SET plan = 'MEMBER' WHERE plan = 'FREE'").run();
  db.prepare("UPDATE users SET plan = 'PARTNER' WHERE plan = 'PRO'").run();
  db.prepare("UPDATE settings SET key = 'member_visible_count' WHERE key = 'free_visible_count'").run();
}

/** Drop the sub-notification toggles replaced by the single master switch. */
function migrateDeviceNotificationPrefs(): void {
  const cols = tableColumns('devices');
  for (const col of ['trading_signals_enabled', 'buy_signals_enabled', 'sell_signals_enabled']) {
    if (cols.includes(col)) {
      try {
        db.exec(`ALTER TABLE devices DROP COLUMN ${col}`);
        console.log(`[migrate] dropped devices.${col}`);
      } catch (err) {
        console.error(`[migrate] failed to drop devices.${col}`, err);
      }
    }
  }
}

/* --------------------------------- seeding -------------------------------- */

/** Sample rows so a fresh install is not an empty screen. Clearly flagged as samples. */
function seedSampleSignals(): void {
  const row = db.prepare('SELECT COUNT(*) AS c FROM signals').get() as { c: number };
  if (row.c > 0) return;

  const base = Date.now();
  const samples: {
    symbol: string;
    market: string;
    action: string;
    price: number;
    sl: number;
    tps: number[];
    tf: string;
    status: string;
    ageH: number;
    result?: string;
    close?: number;
    pnl?: number;
  }[] = [
    { symbol: 'BTCUSDT', market: 'CRYPTO', action: 'BUY', price: 64210, sl: 62800, tps: [65800, 67200, 69500], tf: '1h', status: 'OPEN', ageH: 1 },
    { symbol: 'EURUSD', market: 'FOREX', action: 'SELL', price: 1.0842, sl: 1.0901, tps: [1.0795, 1.0748], tf: '15m', status: 'OPEN', ageH: 3 },
    { symbol: 'ETHUSDT', market: 'CRYPTO', action: 'BUY', price: 3120.5, sl: 3020, tps: [3230, 3340, 3480], tf: '4h', status: 'OPEN', ageH: 6 },
    { symbol: 'XAUUSD', market: 'FOREX', action: 'SELL', price: 2331.4, sl: 2348, tps: [2314, 2298], tf: '1h', status: 'OPEN', ageH: 10 },
    { symbol: 'SOLUSDT', market: 'CRYPTO', action: 'BUY', price: 148.2, sl: 141, tps: [155, 163], tf: '30m', status: 'OPEN', ageH: 20 },
    { symbol: 'GBPUSD', market: 'FOREX', action: 'BUY', price: 1.2711, sl: 1.2664, tps: [1.2802], tf: '1h', status: 'CLOSED', ageH: 30, result: 'TP', close: 1.2802, pnl: 0.72 },
    { symbol: 'BNBUSDT', market: 'CRYPTO', action: 'SELL', price: 592.3, sl: 611, tps: [561], tf: '2h', status: 'CLOSED', ageH: 52, result: 'SL', close: 611, pnl: -3.16 },
    { symbol: 'USDJPY', market: 'FOREX', action: 'BUY', price: 155.12, sl: 154.4, tps: [156.6], tf: '4h', status: 'CLOSED', ageH: 74, result: 'TP', close: 156.6, pnl: 0.95 },
    { symbol: 'ADAUSDT', market: 'CRYPTO', action: 'BUY', price: 0.4521, sl: 0.431, tps: [0.472, 0.498], tf: '1h', status: 'CLOSED', ageH: 96, result: 'TP', close: 0.498, pnl: 10.15 },
    { symbol: 'AUDUSD', market: 'FOREX', action: 'SELL', price: 0.6634, sl: 0.6681, tps: [0.6552], tf: '30m', status: 'CLOSED', ageH: 140, result: 'MANUAL', close: 0.6601, pnl: 0.5 },
    { symbol: 'XRPUSDT', market: 'CRYPTO', action: 'SELL', price: 0.5211, sl: 0.5402, tps: [0.488], tf: '1h', status: 'CLOSED', ageH: 190, result: 'SL', close: 0.5402, pnl: -3.67 },
    { symbol: 'ETHUSDT', market: 'CRYPTO', action: 'BUY', price: 2980, sl: 2890, tps: [3180], tf: '4h', status: 'CLOSED', ageH: 250, result: 'TP', close: 3180, pnl: 6.71 },
  ];

  const insert = db.prepare(`
    INSERT INTO signals (
      external_signal_id, strategy_name, symbol, market, action, price, stop_loss, take_profit,
      take_profits, timeframe, status, result, close_price, closed_at, pnl_percent, note, is_sample,
      signal_timestamp, received_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);

  for (const s of samples) {
    const ts = new Date(base - s.ageH * 3600 * 1000).toISOString();
    const closedAt = s.status === 'CLOSED' ? new Date(base - (s.ageH - 1) * 3600 * 1000).toISOString() : null;
    insert.run(
      'sample-' + sha1(s.symbol + s.action + s.ageH).slice(0, 16),
      'Sample Strategy',
      s.symbol,
      s.market,
      s.action,
      s.price,
      s.sl,
      s.tps[0],
      JSON.stringify(s.tps),
      s.tf,
      s.status,
      s.result ?? null,
      s.close ?? null,
      closedAt,
      s.pnl ?? null,
      'Demo data shipped with the app. Delete it from the admin panel before going live.',
      ts,
      ts,
      ts,
    );
  }
  console.log('[seed] inserted sample signals');
}

export function initDatabase(): void {
  migrate(SCHEMA_SQL);

  // Additive migrations for databases created by an earlier version.
  ensureColumn('signals', 'take_profits', 'TEXT');
  ensureColumn('signals', 'edited_at', 'TEXT');
  ensureColumn('signals', 'edit_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('signals', 'deleted_at', 'TEXT');
  ensureColumn('devices', 'push_token', 'TEXT');
  migrateDeliveryJobs();
  migrateDeliveryJobKindUnique();
  backfillTakeProfits();
  migrateTierNames();
  migrateDeviceNotificationPrefs();

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const exists = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
    if (!exists) setSetting(key, value);
  }

  const adminHash = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password_hash');
  if (!adminHash) {
    if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
      console.error('[init] Refusing to seed a default admin password in production — set ADMIN_PASSWORD.');
      process.exit(1);
    }
    const password = process.env.ADMIN_PASSWORD || 'Kx7-Panel-Trade-92';
    setSetting('admin_username', process.env.ADMIN_USERNAME || 'admin');
    setSetting('admin_password_hash', hashPassword(password));
    console.log('[init] admin credentials initialised');
  }

  if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get('installed_at')) {
    setSetting('installed_at', nowIso());
  }

  seedSampleSignals();
}
