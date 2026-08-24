import { api } from './api';
import type { PendingNotification } from './types';

/**
 * Notification delivery on the device side.
 *
 * The backend keeps a per-device queue (see server/core/distribution.ts). While
 * the app is running we drain that queue and raise a system notification for
 * each item. If the browser/WebView blocks notifications we still surface the
 * item as an in-app toast, so nothing is silently lost.
 *
 * Delivery while the app is fully closed requires a push transport: set
 * FCM_SERVER_KEY on the server and the same jobs are sent through FCM instead.
 */

function notificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function pushIsNative(): boolean {
  if (!notificationSupported()) return false;
  return Notification.permission === 'granted';
}

export async function requestPushPermission(): Promise<boolean> {
  if (!notificationSupported()) return false;
  try {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch (err) {
    console.warn('notification permission request failed', err);
    return false;
  }
}

function showLocalNotification(item: PendingNotification): void {
  if (!notificationSupported() || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification(item.title, {
      body: item.body,
      tag: 'signal-' + item.signalId,
      data: { type: item.type, signalId: item.signalId },
    });
    notification.onclick = () => {
      window.focus();
      window.location.assign('/signal/' + item.signalId);
    };
  } catch (err) {
    console.warn('could not raise a notification', err);
  }
}

export type PushHandler = (items: PendingNotification[]) => void;

/**
 * Drains the device's notification queue on the backend.
 * Returns a stop function.
 */
export function startPushPolling(handler: PushHandler, intervalMs = 15000): () => void {
  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const res = await api<{ items: PendingNotification[] }>('/notifications/pending');
      const items = res.items ?? [];
      if (items.length === 0) return;
      await api('/notifications/ack', {
        method: 'POST',
        body: { jobIds: items.map((i) => i.jobId) },
      });
      for (const item of items) showLocalNotification(item);
      handler(items);
    } catch {
      /* offline or backend restarting — the next tick retries */
    }
  }

  void tick();
  const timer = window.setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
