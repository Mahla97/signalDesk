import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlusMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // The mobile shell loads its assets from https://localhost, so every API
    // call is cross-origin. Auth travels in explicit headers (not cookies), so
    // a wildcard origin exposes nothing a caller couldn't already fetch.
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

const MAX_BODY = 256 * 1024;

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new Error('payload too large');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    throw new Error('invalid json');
  }
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('hex');
}

export function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/* ------------------------------ rate limiting ------------------------------ */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Drops expired buckets. Only clears live ones as a last-resort memory guard. */
function pruneBuckets(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  if (buckets.size > 100_000) buckets.clear();
}

/** True when `key` has already used up `limit` hits in its current window. */
export function isLimited(key: string, limit: number): boolean {
  const bucket = buckets.get(key);
  return Boolean(bucket && bucket.resetAt > Date.now() && bucket.count >= limit);
}

/** Records one hit against `key` (starts a new window when the old one expired). */
export function recordHit(key: string, windowMs: number): void {
  const now = Date.now();
  pruneBuckets(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) buckets.set(key, { count: 1, resetAt: now + windowMs });
  else bucket.count += 1;
}

/** Fixed-window limiter that counts every call. Returns true when the call is allowed. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  if (isLimited(key, limit)) return false;
  recordHit(key, windowMs);
  return true;
}

/**
 * Client IP for rate limiting. `X-Forwarded-For` is client-controlled, so it is
 * only honoured when TRUST_PROXY_HOPS says how many reverse proxies we sit
 * behind (1 for a single Caddy/nginx/PaaS router). We then take the entry that
 * the outermost trusted proxy appended — never the client-supplied left side.
 */
export function clientIp(req: IncomingMessage): string {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  const fwd = req.headers['x-forwarded-for'];
  if (hops > 0 && typeof fwd === 'string' && fwd.length > 0) {
    const chain = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    const ip = chain[chain.length - hops];
    if (ip) return ip;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Tiny path matcher: match('/api/signals/:id', '/api/signals/12') -> { id: '12' } */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) {
      params[p[i].slice(1)] = decodeURIComponent(s[i]);
    } else if (p[i] !== s[i]) {
      return null;
    }
  }
  return params;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toStr(value: unknown, max = 200): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function startOfUtcDayIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}
