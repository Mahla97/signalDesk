export const KEYS = {
  device: 'sd.deviceToken',
  push: 'sd.pushToken',
  session: 'sd.sessionToken',
  timezone: 'sd.timezone',
  onboarded: 'sd.onboarded',
  prefs: 'sd.prefs',
  admin: 'sd.adminToken',
} as const;

export function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the app still works, it just forgets */
  }
}

export function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = read(key);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  write(key, JSON.stringify(value));
}

function randomId(): string {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoObj && 'randomUUID' in cryptoObj) return cryptoObj.randomUUID();
  return 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Stable per-install identifier. Survives FCM token rotation. */
export function deviceToken(): string {
  const existing = read(KEYS.device);
  if (existing) return existing;
  const token = randomId();
  write(KEYS.device, token);
  return token;
}

/** The current FCM registration token, if the native push plugin has issued one. */
export function pushToken(): string | null {
  return read(KEYS.push);
}

export function setPushToken(token: string): void {
  write(KEYS.push, token);
}
