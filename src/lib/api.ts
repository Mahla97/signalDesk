import { KEYS, deviceToken, read, remove } from './storage';

/** Fired on window when an admin call comes back 401 (expired or revoked session). */
export const ADMIN_SESSION_EXPIRED = 'sd:admin-session-expired';

export class ApiError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  admin?: boolean;
  signal?: AbortSignal;
};

/**
 * Origin of the backend API.
 *
 * On the web the app shares an origin with the API — Vite proxies `/api` in dev
 * and the backend serves the built app in production — so this stays empty. The
 * native shell has no shared origin (its WebView is served from
 * https://localhost), so the backend's absolute origin must be baked in at build
 * time via `VITE_API_BASE_URL`, e.g. `http://10.0.2.2:3001` for an emulator or
 * `http://<lan-ip>:3001` for a phone on the same network.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-device-token': deviceToken(),
  };

  const session = read(KEYS.session);
  if (session) headers.Authorization = 'Bearer ' + session;

  if (options.admin) {
    const adminToken = read(KEYS.admin);
    if (adminToken) headers['x-admin-token'] = adminToken;
  }

  let res: Response;
  try {
    res = await fetch(API_BASE + '/api' + path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Network unreachable. Check your connection and try again.');
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }

  if (!res.ok) {
    if (options.admin && res.status === 401) {
      // Admin sessions expire after 12h; send the panel back to its login form.
      remove(KEYS.admin);
      window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED));
    }
    const message = typeof data.error === 'string' ? data.error : 'Request failed (' + res.status + ')';
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}
