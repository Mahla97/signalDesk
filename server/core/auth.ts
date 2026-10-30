import type { IncomingMessage } from 'node:http';
import { db } from '../lib/db.js';
import { USER_SESSION_TTL_MS } from './schema.js';
import { header, hashPassword, isoPlusMs, nowIso, randomToken, sha1, sha256, verifyPassword } from './util.js';

export type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  plan: string;
  partner_status: string;
  partner_start_at: string | null;
  partner_end_at: string | null;
  suspended: number;
  timezone: string | null;
  created_at: string;
  last_seen_at: string | null;
};

export type PublicUser = {
  id: number;
  email: string;
  plan: 'MEMBER' | 'PARTNER';
  partnerStatus: string;
  partnerStartAt: string | null;
  partnerEndAt: string | null;
  partnerRemainingMs: number;
  suspended: boolean;
  timezone: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

export function isPartnerActive(user: UserRow | null | undefined): boolean {
  if (!user) return false;
  if (user.suspended) return false;
  if (user.plan !== 'PARTNER') return false;
  if (!user.partner_end_at) return false;
  return new Date(user.partner_end_at).getTime() > Date.now();
}

export function publicUser(user: UserRow): PublicUser {
  const remaining = user.partner_end_at ? new Date(user.partner_end_at).getTime() - Date.now() : 0;
  return {
    id: user.id,
    email: user.email,
    plan: isPartnerActive(user) ? 'PARTNER' : 'MEMBER',
    partnerStatus: user.partner_status,
    partnerStartAt: user.partner_start_at,
    partnerEndAt: user.partner_end_at,
    partnerRemainingMs: Math.max(0, remaining),
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
    'INSERT INTO users (email, password_hash, plan, partner_status, timezone, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(email.toLowerCase(), hashPassword(password), 'MEMBER', 'INACTIVE', timezone, now, now);
  return findUserByEmail(email) as UserRow;
}

export function login(email: string, password: string): { token: string; user: UserRow } | null {
  const user = findUserByEmail(email);
  if (!user) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  const token = createUserSession(user.id);
  touchUser(user.id);
  return { token, user };
}

export function logout(token: string): void {
  db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(token));
}

/* -------------------------------- sessions -------------------------------- */

/** A shared Partner login can only stay signed in on this many devices. */
export const MAX_SESSIONS_PER_USER = 3;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Sliding expiry is pushed forward at most this often, to avoid a write per request. */
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

function createUserSession(userId: number): string {
  const token = randomToken(32);
  const now = nowIso();
  db.prepare(
    'INSERT INTO auth_sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(sha256(token), userId, now, now, isoPlusMs(USER_SESSION_TTL_MS));
  // Oldest sessions beyond the cap are signed out.
  db.prepare(
    `DELETE FROM auth_sessions WHERE user_id = ? AND rowid NOT IN
       (SELECT rowid FROM auth_sessions WHERE user_id = ? ORDER BY rowid DESC LIMIT ?)`,
  ).run(userId, userId, MAX_SESSIONS_PER_USER);
  return token;
}

/** Removes expired user/admin sessions and reset tokens. Run from the cron. */
export function purgeExpiredSessions(): void {
  const now = nowIso();
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now);
}

export function touchUser(userId: number): void {
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), userId);
}

/* ------------------------------ password reset ----------------------------- */

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Creates a single-use reset token and returns the raw value to email out. */
export function createPasswordReset(userId: number): string {
  const token = randomToken(32);
  db.prepare(
    'INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(sha1(token), userId, isoPlusMs(RESET_TOKEN_TTL_MS), nowIso());
  return token;
}

/** Consumes a reset token and sets the new password. Returns false when invalid/expired. */
export function resetPasswordWithToken(token: string, password: string): boolean {
  const hash = sha1(token);
  const row = db
    .prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?')
    .get(hash) as { user_id: number; expires_at: string } | undefined;
  if (!row) return false;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(hash);
    return false;
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.user_id);
  db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(hash);
  // Invalidate every session so anyone holding the old password is signed out.
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(row.user_id);
  return true;
}

export function deleteUser(userId: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

export function bearer(req: IncomingMessage): string {
  const raw = header(req, 'authorization');
  if (raw.toLowerCase().startsWith('bearer ')) return raw.slice(7).trim();
  return '';
}

export function currentUser(req: IncomingMessage): UserRow | null {
  const token = bearer(req);
  if (!token) return null;
  const hash = sha256(token);
  const now = Date.now();
  const session = db
    .prepare('SELECT user_id, last_used_at FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(hash, new Date(now).toISOString()) as { user_id: number; last_used_at: string } | undefined;
  if (!session) return null;
  if (now - new Date(session.last_used_at).getTime() > SESSION_TOUCH_INTERVAL_MS) {
    db.prepare('UPDATE auth_sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?').run(
      new Date(now).toISOString(),
      isoPlusMs(USER_SESSION_TTL_MS),
      hash,
    );
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as UserRow | undefined;
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
  db.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    nowIso(),
    isoPlusMs(ADMIN_SESSION_TTL_MS),
  );
  return token;
}

export function isAdmin(req: IncomingMessage): boolean {
  const token = header(req, 'x-admin-token');
  if (!token) return false;
  const row = db
    .prepare('SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(sha256(token), nowIso());
  return Boolean(row);
}

export function adminLogout(req: IncomingMessage): void {
  const token = header(req, 'x-admin-token');
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
}

/** Scheduled job: any PARTNER whose window has passed falls back to MEMBER. */
export function expirePartnerAccess(): number {
  const res = db
    .prepare(
      `UPDATE users SET plan = 'MEMBER', partner_status = 'EXPIRED'
       WHERE plan = 'PARTNER' AND partner_end_at IS NOT NULL AND partner_end_at <= ?`,
    )
    .run(nowIso());
  const changed = Number(res.changes ?? 0);
  if (changed > 0) console.log(`[cron] downgraded ${changed} expired PARTNER user(s)`);
  return changed;
}
