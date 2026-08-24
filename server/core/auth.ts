import type { IncomingMessage } from 'node:http';
import { db } from '../lib/db.js';
import { header, hashPassword, nowIso, randomToken, verifyPassword } from './util.js';

export type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  plan: string;
  subscription_status: string;
  pro_start_at: string | null;
  pro_end_at: string | null;
  suspended: number;
  timezone: string | null;
  created_at: string;
  last_seen_at: string | null;
};

export type PublicUser = {
  id: number;
  email: string;
  plan: 'FREE' | 'PRO';
  subscriptionStatus: string;
  proStartAt: string | null;
  proEndAt: string | null;
  proRemainingMs: number;
  suspended: boolean;
  timezone: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

export function isProActive(user: UserRow | null | undefined): boolean {
  if (!user) return false;
  if (user.suspended) return false;
  if (user.plan !== 'PRO') return false;
  if (!user.pro_end_at) return false;
  return new Date(user.pro_end_at).getTime() > Date.now();
}

export function publicUser(user: UserRow): PublicUser {
  const remaining = user.pro_end_at ? new Date(user.pro_end_at).getTime() - Date.now() : 0;
  return {
    id: user.id,
    email: user.email,
    plan: isProActive(user) ? 'PRO' : 'FREE',
    subscriptionStatus: user.subscription_status,
    proStartAt: user.pro_start_at,
    proEndAt: user.pro_end_at,
    proRemainingMs: Math.max(0, remaining),
    suspended: Boolean(user.suspended),
    timezone: user.timezone,
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at,
  };
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | UserRow
    | undefined;
}

export function createUser(email: string, password: string, timezone: string | null): UserRow {
  const now = nowIso();
  db.prepare(
    'INSERT INTO users (email, password_hash, plan, subscription_status, timezone, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(email.toLowerCase(), hashPassword(password), 'FREE', 'INACTIVE', timezone, now, now);
  return findUserByEmail(email) as UserRow;
}

export function login(email: string, password: string): { token: string; user: UserRow } | null {
  const user = findUserByEmail(email);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  const token = randomToken(32);
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(
    token,
    user.id,
    nowIso(),
  );
  touchUser(user.id);
  return { token, user };
}

export function logout(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function touchUser(userId: number): void {
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), userId);
}

export function bearer(req: IncomingMessage): string {
  const raw = header(req, 'authorization');
  if (raw.toLowerCase().startsWith('bearer ')) return raw.slice(7).trim();
  return '';
}

export function currentUser(req: IncomingMessage): UserRow | null {
  const token = bearer(req);
  if (!token) return null;
  const row = db
    .prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
    )
    .get(token) as UserRow | undefined;
  return row ?? null;
}

/* ---------------------------------- admin --------------------------------- */

export function adminLogin(username: string, password: string): string | null {
  const expectedUser = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_username') as
    | { value: string }
    | undefined;
  const expectedHash = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('admin_password_hash') as { value: string } | undefined;
  if (!expectedUser || !expectedHash) return null;
  if (username.trim().toLowerCase() !== expectedUser.value.toLowerCase()) return null;
  if (!verifyPassword(password, expectedHash.value)) return null;
  const token = randomToken(32);
  db.prepare('INSERT INTO admin_tokens (token, created_at) VALUES (?, ?)').run(token, nowIso());
  return token;
}

export function isAdmin(req: IncomingMessage): boolean {
  const token = header(req, 'x-admin-token');
  if (!token) return false;
  const row = db.prepare('SELECT 1 FROM admin_tokens WHERE token = ?').get(token);
  return Boolean(row);
}

export function adminLogout(req: IncomingMessage): void {
  const token = header(req, 'x-admin-token');
  if (token) db.prepare('DELETE FROM admin_tokens WHERE token = ?').run(token);
}

/** Scheduled job: any PRO whose window has passed falls back to FREE. */
export function expireProSubscriptions(): number {
  const res = db
    .prepare(
      `UPDATE users SET plan = 'FREE', subscription_status = 'EXPIRED'
       WHERE plan = 'PRO' AND pro_end_at IS NOT NULL AND pro_end_at <= ?`,
    )
    .run(nowIso());
  const changed = Number(res.changes ?? 0);
  if (changed > 0) console.log(`[cron] downgraded ${changed} expired PRO user(s)`);
  return changed;
}
