import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';
import {
  KEYS,
  deviceToken,
  pushToken,
  read,
  readJson,
  remove,
  setPushToken,
  write,
  writeJson,
} from './storage';
import { deviceTimezone } from './time';
import { requestPushPermission, startPushPolling } from './push';
import { isNativePlatform, nativePlatformName, registerNativePush } from './nativePush';
import type { AppConfig, AppUser, NotificationPreferences, PendingNotification } from './types';

const DEFAULT_PREFS: NotificationPreferences = {
  notificationsEnabled: true,
};

const DEFAULT_CONFIG: AppConfig = {
  telegramUrl: 'https://t.me/signaldesk',
  websiteUrl: 'https://signaldesk.example.com',
  instagramUrl: 'https://instagram.com/signaldesk',
  supportEmail: 'support@signaldesk.example.com',
  memberVisibleCount: 3,
  historyDays: 14,
  stats: { total: 0, wins: 0, losses: 0, winRate: 0 },
};

type Toast = { id: number; title: string; body: string; signalId: number; kind: 'NEW' | 'UPDATE' | 'DELETE' };

type Store = {
  ready: boolean;
  onboarded: boolean;
  timezone: string;
  prefs: NotificationPreferences;
  config: AppConfig;
  user: AppUser | null;
  isPartner: boolean;
  toasts: Toast[];
  signalTick: number;
  completeOnboarding: (timezone: string) => void;
  setTimezone: (timezone: string) => void;
  setPrefs: (prefs: NotificationPreferences) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  dismissToast: (id: number) => void;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(() => read(KEYS.onboarded) === '1');
  const [timezone, setTimezoneState] = useState(() => read(KEYS.timezone) || deviceTimezone());
  const [prefs, setPrefsState] = useState<NotificationPreferences>(() =>
    readJson<NotificationPreferences>(KEYS.prefs, DEFAULT_PREFS),
  );
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [user, setUser] = useState<AppUser | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [signalTick, setSignalTick] = useState(0);
  const registered = useRef(false);

  const registerDevice = useCallback(
    async (nextPrefs: NotificationPreferences, tz: string) => {
      try {
        await api<{ id: number }>('/devices/push-token', {
          method: 'POST',
          body: {
            token: deviceToken(),
            pushToken: pushToken(),
            platform: nativePlatformName(),
            timezone: tz,
            preferences: nextPrefs,
          },
        });
      } catch (err) {
        console.warn('device registration failed', err);
      }
    },
    [],
  );

  const refreshUser = useCallback(async () => {
    if (!read(KEYS.session)) {
      setUser(null);
      return;
    }
    try {
      const res = await api<{ user: AppUser | null; device: { id: number } | null }>('/auth/me');
      setUser(res.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        remove(KEYS.session);
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot(): Promise<void> {
      try {
        const cfg = await api<AppConfig>('/config');
        if (!cancelled) setConfig({ ...DEFAULT_CONFIG, ...cfg });
      } catch {
        /* keep defaults — the UI still renders */
      }
      if (!registered.current) {
        registered.current = true;
        await registerDevice(prefs, timezone);
      }
      await refreshUser();
      if (!cancelled) setReady(true);
    }

    void boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Native shell: FCM delivers (and the OS displays) the notification, so there
    // is nothing to poll — we only register the token and toast foreground items.
    // Web: drain the backend queue while the tab is open.
    if (isNativePlatform()) {
      let cancelled = false;
      let stop: (() => void) | null = null;
      void registerNativePush({
        onToken: (token) => {
          setPushToken(token);
          void registerDevice(prefs, timezone);
        },
        onMessage: (message) => {
          setToasts((current) => [
            ...current,
            {
              id: Date.now(),
              title: message.title,
              body: message.body,
              signalId: message.signalId ?? 0,
              kind: message.kind,
            },
          ]);
          setSignalTick((t) => t + 1);
          void refreshUser();
        },
      }).then((cleanup) => {
        if (cancelled) cleanup();
        else stop = cleanup;
      });
      return () => {
        cancelled = true;
        stop?.();
      };
    }

    const stop = startPushPolling((items: PendingNotification[]) => {
      setToasts((current) => [
        ...current,
        ...items.map((i) => ({
          id: i.jobId,
          title: i.title,
          body: i.body,
          signalId: i.signalId,
          kind: i.kind === 'UPDATE' ? ('UPDATE' as const) : i.kind === 'DELETE' ? ('DELETE' as const) : ('NEW' as const),
        })),
      ]);
      setSignalTick((t) => t + 1);
      void refreshUser();
    });
    return stop;
  }, [refreshUser, registerDevice, prefs, timezone]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => setToasts((c) => c.slice(1)), 7000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const completeOnboarding = useCallback(
    (tz: string) => {
      write(KEYS.timezone, tz);
      write(KEYS.onboarded, '1');
      setTimezoneState(tz);
      setOnboarded(true);
      void api('/auth/timezone', { method: 'PATCH', body: { timezone: tz } }).catch(() => undefined);
      void requestPushPermission();
    },
    [],
  );

  const setTimezone = useCallback((tz: string) => {
    write(KEYS.timezone, tz);
    setTimezoneState(tz);
    void api('/auth/timezone', { method: 'PATCH', body: { timezone: tz } }).catch(() => undefined);
  }, []);

  const setPrefs = useCallback(
    (next: NotificationPreferences) => {
      setPrefsState(next);
      writeJson(KEYS.prefs, next);
      if (next.notificationsEnabled) void requestPushPermission();
      void registerDevice(next, read(KEYS.timezone) || deviceTimezone());
    },
    [registerDevice],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ token: string; user: AppUser }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      write(KEYS.session, res.token);
      setUser(res.user);
      await registerDevice(prefs, timezone);
    },
    [prefs, timezone, registerDevice],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ token: string; user: AppUser }>('/auth/signup', {
        method: 'POST',
        body: { email, password, timezone },
      });
      write(KEYS.session, res.token);
      setUser(res.user);
      await registerDevice(prefs, timezone);
    },
    [prefs, timezone, registerDevice],
  );

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* the local session is cleared either way */
    }
    remove(KEYS.session);
    setUser(null);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const value = useMemo<Store>(
    () => ({
      ready,
      onboarded,
      timezone,
      prefs,
      config,
      user,
      isPartner: user?.plan === 'PARTNER' && !user.suspended,
      toasts,
      signalTick,
      completeOnboarding,
      setTimezone,
      setPrefs,
      signIn,
      signUp,
      signOut,
      refreshUser,
      dismissToast,
    }),
    [
      ready,
      onboarded,
      timezone,
      prefs,
      config,
      user,
      toasts,
      signalTick,
      completeOnboarding,
      setTimezone,
      setPrefs,
      signIn,
      signUp,
      signOut,
      refreshUser,
      dismissToast,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
