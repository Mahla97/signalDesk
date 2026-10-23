/**
 * Stub for `firebase/messaging` used only by the browser build.
 *
 * @capacitor-firebase/messaging ships a web implementation that lazily imports
 * the Firebase JS SDK. SignalDesk delivers push natively (see nativePush.ts) and
 * never runs that web path, so alias this file in vite.config.ts to keep the
 * Firebase SDK out of the web bundle — and to let the build resolve when it is
 * not installed at all.
 *
 * If you ever add real Web Push, replace this alias with the real `firebase`
 * dependency instead.
 */

function unsupported(): never {
  throw new Error('Web push is not configured. Push is delivered through the native app.');
}

export function getMessaging(): never {
  return unsupported();
}

export function getToken(): never {
  return unsupported();
}

export function deleteToken(): never {
  return unsupported();
}

export function onMessage(): never {
  return unsupported();
}

export function isSupported(): Promise<boolean> {
  return Promise.resolve(false);
}
