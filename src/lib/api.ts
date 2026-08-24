import { KEYS, deviceToken, read } from './storage';

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
    res = await fetch('/api' + path, {
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
    const message = typeof data.error === 'string' ? data.error : 'Request failed (' + res.status + ')';
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}
