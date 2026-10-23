import { Capacitor, type PluginListenerHandle } from '@capacitor/core';

/**
 * Native (Capacitor) push plumbing.
 *
 * On the web there is no FCM token — the app drains the backend queue instead
 * (see push.ts). Inside the Android shell this module registers for FCM, hands
 * the rotating registration token to the caller, and surfaces taps so the app
 * can open the right signal.
 *
 * Everything here is a no-op on the web build, so it is safe to import anywhere.
 */

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/** 'android' | 'ios' | 'web' — stored on the device row so the server can aim pushes. */
export function nativePlatformName(): string {
  return Capacitor.getPlatform();
}

function asSignalId(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export type PushMessage = {
  title: string;
  body: string;
  signalId: number | null;
  kind: 'NEW' | 'UPDATE' | 'DELETE';
};

export type NativePushHandlers = {
  /** A (new) FCM registration token — register it with the backend. */
  onToken: (token: string) => void;
  /** A push arrived while the app is in the foreground. */
  onMessage?: (message: PushMessage) => void;
};

/**
 * Requests permission, wires the token + foreground listeners and returns a
 * cleanup function. No-op on the web.
 */
export async function registerNativePush(handlers: NativePushHandlers): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};
  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

  const permission = await FirebaseMessaging.requestPermissions();
  if (permission.receive !== 'granted') {
    console.warn('[push] notification permission not granted');
    return () => {};
  }

  const handles: PluginListenerHandle[] = [];
  handles.push(
    await FirebaseMessaging.addListener('tokenReceived', (event) => {
      if (event.token) handlers.onToken(event.token);
    }),
  );
  handles.push(
    await FirebaseMessaging.addListener('notificationReceived', (event) => {
      const notification = event.notification;
      const data = (notification.data ?? {}) as Record<string, unknown>;
      handlers.onMessage?.({
        title: notification.title ?? '',
        body: notification.body ?? '',
        signalId: asSignalId(data.signalId),
        kind: data.event === 'SIGNAL_UPDATED' ? 'UPDATE' : data.event === 'SIGNAL_DELETED' ? 'DELETE' : 'NEW',
      });
    }),
  );

  const { token } = await FirebaseMessaging.getToken();
  if (token) handlers.onToken(token);

  return () => {
    for (const handle of handles) void handle.remove();
  };
}

/**
 * Fires when the user taps a push notification. The FCM data payload carries
 * `signalId` (see server/core/distribution.ts), which is what we open.
 * No-op on the web.
 */
export async function addNotificationTapListener(
  onTap: (signalId: number) => void,
): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};
  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
  const handle = await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
    const data = (event.notification.data ?? {}) as Record<string, unknown>;
    const signalId = asSignalId(data.signalId);
    if (signalId !== null) onTap(signalId);
  });
  return () => void handle.remove();
}
