import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  LogOut,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { KEYS, read, remove, write } from '../lib/storage';
import { Badge, Button, ErrorState, Panel, Skeleton } from '../components/ui';
import { formatDateTime, formatPrice } from '../lib/time';
import type { AdminUser, DeliveryLog, Signal, SignalChange, WebhookEvent } from '../lib/types';

type Overview = {
  users: number;
  proUsers: number;
  devices: number;
  signals: number;
  pushSent: number;
  pushFailed: number;
  editedSignals?: number;
  performance: { total: number; wins: number; losses: number; winRate: number };
  webhookSecretConfigured: boolean;
};

type Tab = 'overview' | 'users' | 'signals' | 'logs' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'signals', label: 'Signals' },
  { id: 'logs', label: 'Delivery logs' },
  { id: 'settings', label: 'Settings' },
];

const MAX_TPS = 8;

const inputClass =
  'min-h-11 w-full rounded-xl border border-[#243049] bg-[#0c1220] px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/30';

const iconButtonClass =
  'grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#243049] text-slate-300 transition hover:bg-white/5 disabled:opacity-40';

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function cleanTakeProfits(values: string[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    const n = toNumberOrNull(value);
    if (n === null || n <= 0) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/* ------------------------- multiple take profit rows ----------------------- */

function TakeProfitEditor({
  values,
  onChange,
  idPrefix,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  idPrefix: string;
}): React.ReactElement {
  function setAt(index: number, value: string): void {
    const next = [...values];
    next[index] = value;
    onChange(next);
  }

  function removeAt(index: number): void {
    const next = values.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : ['']);
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <span className="block text-sm font-bold text-slate-200">Take profit levels</span>
      {values.map((value, index) => (
        <div key={index} className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-xs font-bold uppercase tracking-wide text-emerald-300/80">
            TP{index + 1}
          </span>
          <input
            value={value}
            onChange={(e) => setAt(index, e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            data-testid={`${idPrefix}-tp-${index + 1}`}
            className={inputClass + ' min-w-0 flex-1'}
          />
          <button
            type="button"
            onClick={() => move(index, -1)}
            disabled={index === 0}
            aria-label={`Move TP${index + 1} up`}
            data-testid={`${idPrefix}-tp-up-${index + 1}`}
            className={iconButtonClass}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => move(index, 1)}
            disabled={index === values.length - 1}
            aria-label={`Move TP${index + 1} down`}
            data-testid={`${idPrefix}-tp-down-${index + 1}`}
            className={iconButtonClass}
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => removeAt(index)}
            aria-label={`Remove TP${index + 1}`}
            data-testid={`${idPrefix}-tp-remove-${index + 1}`}
            className={iconButtonClass + ' border-rose-500/30 text-rose-300 hover:bg-rose-500/10'}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        disabled={values.length >= MAX_TPS}
        data-testid={`${idPrefix}-tp-add`}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 text-sm font-bold text-sky-200 transition hover:bg-sky-500/20 disabled:opacity-40"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add take profit
      </button>
    </div>
  );
}

/* -------------------------------- admin login ------------------------------ */

function AdminLogin({ onDone }: { onDone: () => void }): React.ReactElement {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string }>('/admin/login', {
        method: 'POST',
        body: { username, password },
      });
      write(KEYS.admin, res.token);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm py-10">
      <Panel className="p-5" testId="admin-login">
        <h1 className="text-lg font-extrabold text-slate-100">Staff sign in</h1>
        <p className="mt-1 text-sm text-slate-400">Management panel — authorised staff only.</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-slate-200">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              data-testid="admin-username"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-bold text-slate-200">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              data-testid="admin-password"
              className={inputClass}
            />
          </label>
          {error ? (
            <p className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200" data-testid="admin-error">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy} testId="admin-login-submit">
            {busy ? 'Checking…' : 'Sign in'}
          </Button>
        </form>
        <Link to="/" className="mt-4 block text-center text-sm text-slate-500 hover:text-slate-300">
          ← Back to the app
        </Link>
      </Panel>
    </div>
  );
}

/* --------------------------------- overview -------------------------------- */

function OverviewTab(): React.ReactElement {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<Overview>('/admin/overview', { admin: true }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the overview.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} testId="admin-overview-error" />;
  if (!data)
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );

  const cards = [
    { label: 'Users', value: data.users },
    { label: 'Active Pro', value: data.proUsers },
    { label: 'Devices', value: data.devices },
    { label: 'Signals', value: data.signals },
    { label: 'Push sent', value: data.pushSent },
    { label: 'Push failed', value: data.pushFailed },
    { label: 'Edited signals', value: data.editedSignals ?? 0 },
  ];

  return (
    <div className="space-y-4" data-testid="admin-overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {cards.map((c) => (
          <Panel key={c.label} className="p-4">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="text-2xl font-extrabold text-slate-100">{c.value}</p>
          </Panel>
        ))}
      </div>
      <Panel className="p-4">
        <p className="text-sm font-bold text-slate-100">Closed signal performance</p>
        <p className="mt-1 text-sm text-slate-400">
          {data.performance.total} closed · {data.performance.wins} TP · {data.performance.losses} SL ·{' '}
          <span className="font-bold text-emerald-400">{data.performance.winRate}% win rate</span>
        </p>
      </Panel>
      {!data.webhookSecretConfigured ? (
        <Panel className="border-amber-500/30 p-4">
          <p className="text-sm font-bold text-amber-200">Webhook secret not set</p>
          <p className="mt-1 text-sm text-slate-400">
            The server is using the built-in default secret. Set the environment variable
            <span className="mx-1 font-mono text-slate-200">TRADINGVIEW_WEBHOOK_SECRET</span>
            before pointing real TradingView alerts at it.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}

/* ---------------------------------- users ---------------------------------- */

function UsersTab(): React.ReactElement {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<Record<number, number>>({});
  const [pending, setPending] = useState<Record<number, boolean>>({});

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ items: AdminUser[] }>('/admin/users?q=' + encodeURIComponent(q), {
        admin: true,
      });
      setUsers(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  async function setPlan(user: AdminUser, plan: 'PRO' | 'FREE'): Promise<void> {
    setPending((c) => ({ ...c, [user.id]: true }));
    try {
      const res = await api<{ user: AdminUser }>(`/admin/users/${user.id}/plan`, {
        method: 'POST',
        admin: true,
        body: { plan, days: days[user.id] ?? 30 },
      });
      setUsers((current) => current.map((u) => (u.id === user.id ? res.user : u)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the plan.');
    } finally {
      setPending((c) => ({ ...c, [user.id]: false }));
    }
  }

  async function toggleSuspend(user: AdminUser): Promise<void> {
    setPending((c) => ({ ...c, [user.id]: true }));
    try {
      const res = await api<{ user: AdminUser }>(`/admin/users/${user.id}/suspend`, {
        method: 'POST',
        admin: true,
        body: { suspended: !user.suspended },
      });
      setUsers((current) => current.map((u) => (u.id === user.id ? res.user : u)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the user.');
    } finally {
      setPending((c) => ({ ...c, [user.id]: false }));
    }
  }

  return (
    <div className="space-y-3" data-testid="admin-users">
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email…"
          data-testid="admin-user-search"
          className={inputClass + ' max-w-xs flex-1'}
        />
        <Button variant="ghost" onClick={() => void load(query)} testId="admin-user-search-btn">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Search
        </Button>
      </div>

      {error ? <ErrorState message={error} onRetry={() => void load(query)} /> : null}

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : users.length === 0 ? (
        <Panel className="p-6 text-center text-sm text-slate-400" testId="admin-users-empty">
          No users yet.
        </Panel>
      ) : (
        <div className="space-y-3">
          {users.map((user) => (
            <Panel key={user.id} className="p-4" testId={`admin-user-${user.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-100">{user.email}</span>
                <Badge tone={user.plan === 'PRO' ? 'pro' : 'neutral'}>{user.plan}</Badge>
                {user.suspended ? <Badge tone="sell">SUSPENDED</Badge> : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Joined {formatDateTime(user.createdAt, 'UTC')} · last seen{' '}
                {user.lastSeenAt ? formatDateTime(user.lastSeenAt, 'UTC') : '—'} (UTC)
              </p>
              {user.proEndAt ? (
                <p className="mt-1 text-xs text-slate-400">Pro until {formatDateTime(user.proEndAt, 'UTC')} UTC</p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={days[user.id] ?? 30}
                  onChange={(e) => setDays((c) => ({ ...c, [user.id]: Number(e.target.value) }))}
                  data-testid={`admin-days-${user.id}`}
                  className="min-h-11 rounded-xl border border-[#243049] bg-[#0c1220] px-3 text-sm text-slate-100"
                >
                  {[7, 30, 90, 180, 365].map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
                <Button
                  onClick={() => void setPlan(user, 'PRO')}
                  disabled={pending[user.id]}
                  testId={`admin-grant-pro-${user.id}`}
                >
                  Grant Pro
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void setPlan(user, 'FREE')}
                  disabled={pending[user.id]}
                  testId={`admin-set-free-${user.id}`}
                >
                  Set Free
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void toggleSuspend(user)}
                  disabled={pending[user.id]}
                  testId={`admin-suspend-${user.id}`}
                >
                  {user.suspended ? 'Unsuspend' : 'Suspend'}
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- signals --------------------------------- */

type EditForm = {
  symbol: string;
  action: string;
  price: string;
  stopLoss: string;
  takeProfits: string[];
  timeframe: string;
  strategy: string;
  note: string;
  status: string;
  closePrice: string;
  result: string;
  notify: boolean;
};

function EditSignalDialog({
  signal,
  onClose,
  onSaved,
}: {
  signal: Signal;
  onClose: () => void;
  onSaved: (message: string) => void;
}): React.ReactElement {
  const [form, setForm] = useState<EditForm>({
    symbol: signal.symbol ?? '',
    action: signal.action ?? 'BUY',
    price: signal.price !== null ? String(signal.price) : '',
    stopLoss: signal.stopLoss !== null ? String(signal.stopLoss) : '',
    takeProfits: signal.takeProfits && signal.takeProfits.length > 0 ? signal.takeProfits.map(String) : [''],
    timeframe: signal.timeframe ?? '',
    strategy: signal.strategyName ?? 'Manual',
    note: signal.note ?? '',
    status: signal.status,
    closePrice: signal.closePrice !== null ? String(signal.closePrice) : '',
    result: signal.result ?? '',
    notify: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<SignalChange[]>(signal.changes ?? []);

  const loadChanges = useCallback(async () => {
    try {
      const res = await api<{ changes: SignalChange[] }>(`/admin/signals/${signal.id}/changes`, {
        admin: true,
      });
      setChanges(res.changes);
    } catch {
      /* the log is informational — editing still works without it */
    }
  }, [signal.id]);

  useEffect(() => {
    void loadChanges();
  }, [loadChanges]);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!form.symbol.trim()) {
      setError('Symbol is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ changes: SignalChange[]; notified: boolean }>(`/admin/signals/${signal.id}`, {
        method: 'PATCH',
        admin: true,
        body: {
          symbol: form.symbol.trim().toUpperCase(),
          action: form.action,
          price: toNumberOrNull(form.price),
          stopLoss: toNumberOrNull(form.stopLoss),
          takeProfits: cleanTakeProfits(form.takeProfits),
          timeframe: form.timeframe.trim(),
          strategy: form.strategy.trim() || 'Manual',
          note: form.note.trim(),
          status: form.status,
          closePrice: toNumberOrNull(form.closePrice),
          result: form.result.trim(),
          notify: form.notify,
        },
      });
      const count = res.changes.length;
      onSaved(
        count === 0
          ? 'Nothing changed.'
          : `Saved ${count} change${count > 1 ? 's' : ''}` +
              (res.notified ? ' — followers notified.' : ' — no notification sent.'),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the changes.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit signal ${signal.symbol}`}
      data-testid="admin-edit-dialog"
    >
      <Panel className="my-4 w-full max-w-2xl p-5">
        <div className="flex flex-wrap items-center gap-2">
          <PencilLine className="h-5 w-5 text-amber-300" aria-hidden="true" />
          <h3 className="text-base font-bold text-slate-100">
            Edit published signal #{signal.id} · {signal.symbol}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid="admin-edit-close"
            className="ms-auto grid h-10 w-10 place-items-center rounded-xl border border-[#243049] text-slate-400 hover:bg-white/5"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Edits are logged, the signal is marked “Edited” in the app, and everyone who already received it
          gets an update notice.
        </p>

        <form onSubmit={save} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-200">Symbol</span>
              <input
                value={form.symbol}
                onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                data-testid="admin-edit-symbol"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-200">Action</span>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                data-testid="admin-edit-action"
                className={inputClass}
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
                <option value="CLOSE">CLOSE</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-200">Entry price</span>
              <input
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                inputMode="decimal"
                data-testid="admin-edit-price"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-200">Stop loss</span>
              <input
                value={form.stopLoss}
                onChange={(e) => setForm({ ...form, stopLoss: e.target.value })}
                inputMode="decimal"
                data-testid="admin-edit-stop"
                className={inputClass}
              />
            </label>
          </div>

          <TakeProfitEditor
            values={form.takeProfits}
            onChange={(next) => setForm({ ...form, takeProfits: next })}
            idPrefix="admin-edit"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-200">Timeframe</span>
              <input
                value={form.timeframe}
                onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
                data-testid="admin-edit-timeframe"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-200">Strategy</span>
              <input
                value={form.strategy}
                onChange={(e) => setForm({ ...form, strategy: e.target.value })}
                data-testid="admin-edit-strategy"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-200">Status</span>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                data-testid="admin-edit-status"
                className={inputClass}
              >
                <option value="OPEN">OPEN</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-200">Close price</span>
              <input
                value={form.closePrice}
                onChange={(e) => setForm({ ...form, closePrice: e.target.value })}
                inputMode="decimal"
                disabled={form.status !== 'CLOSED'}
                placeholder={form.status === 'CLOSED' ? '0.00' : 'Only for closed signals'}
                data-testid="admin-edit-close-price"
                className={inputClass + (form.status !== 'CLOSED' ? ' opacity-50' : '')}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-slate-200">Result</span>
              <input
                value={form.result}
                onChange={(e) => setForm({ ...form, result: e.target.value })}
                placeholder="TP / SL / MANUAL"
                disabled={form.status !== 'CLOSED'}
                data-testid="admin-edit-result"
                className={inputClass + (form.status !== 'CLOSED' ? ' opacity-50' : '')}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-bold text-slate-200">Note</span>
              <input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                data-testid="admin-edit-note"
                className={inputClass}
              />
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-[#243049] bg-[#0c1220] p-3">
            <input
              type="checkbox"
              checked={form.notify}
              onChange={(e) => setForm({ ...form, notify: e.target.checked })}
              data-testid="admin-edit-notify"
              className="h-5 w-5 accent-sky-500"
            />
            <span className="min-w-0 text-sm text-slate-300">
              Notify everyone who already received this signal
            </span>
          </label>

          {error ? (
            <p
              className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200"
              data-testid="admin-edit-error"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy} testId="admin-edit-save">
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
            <Button variant="ghost" onClick={onClose} testId="admin-edit-cancel">
              Cancel
            </Button>
          </div>
        </form>

        {changes.length > 0 ? (
          <div className="mt-5 border-t border-[#1a2334] pt-4" data-testid="admin-edit-changelog">
            <p className="text-sm font-bold text-slate-100">Change history</p>
            <ul className="mt-2 space-y-2">
              {changes.map((change, index) => (
                <li key={index} className="rounded-xl border border-[#1d2739] bg-[#0c1220] p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-200">{change.label}</span>
                    <Badge tone="neutral">rev {change.revision}</Badge>
                    <span className="ms-auto text-slate-500">
                      {formatDateTime(change.createdAt, 'UTC')} UTC
                    </span>
                  </div>
                  <p className="mt-1 break-words font-mono">
                    <span className="text-rose-300/80 line-through">{change.oldValue ?? '—'}</span>
                    <span className="mx-2 text-slate-500">→</span>
                    <span className="text-emerald-300">{change.newValue ?? '—'}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function SignalsTab(): React.ReactElement {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Signal | null>(null);
  const [form, setForm] = useState({
    symbol: '',
    action: 'BUY',
    price: '',
    stopLoss: '',
    takeProfits: [''] as string[],
    timeframe: '1h',
    strategy: 'Manual',
    note: '',
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ items: Signal[] }>('/admin/signals', { admin: true });
      setSignals(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load signals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!form.symbol.trim()) {
      setError('Symbol is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/admin/signals', {
        method: 'POST',
        admin: true,
        body: {
          symbol: form.symbol.trim().toUpperCase(),
          action: form.action,
          price: toNumberOrNull(form.price),
          stopLoss: toNumberOrNull(form.stopLoss),
          takeProfits: cleanTakeProfits(form.takeProfits),
          timeframe: form.timeframe,
          strategy: form.strategy,
          note: form.note,
          time: new Date().toISOString(),
        },
      });
      setForm({ ...form, symbol: '', price: '', stopLoss: '', takeProfits: [''], note: '' });
      setNotice('Signal published and queued for delivery.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the signal.');
    } finally {
      setBusy(false);
    }
  }

  async function removeSignal(id: number): Promise<void> {
    try {
      await api('/admin/signals/' + id, { method: 'DELETE', admin: true });
      setSignals((c) => c.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the signal.');
    }
  }

  async function closeSignal(id: number, closePrice: string): Promise<void> {
    try {
      await api(`/admin/signals/${id}/close`, {
        method: 'POST',
        admin: true,
        body: { closePrice: toNumberOrNull(closePrice) },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not close the signal.');
    }
  }

  async function clearSamples(): Promise<void> {
    try {
      await api('/admin/sample-signals', { method: 'DELETE', admin: true });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the sample data.');
    }
  }

  return (
    <div className="space-y-4" data-testid="admin-signals">
      <Panel className="p-4">
        <h3 className="text-sm font-bold text-slate-100">Publish a signal manually</h3>
        <p className="mt-1 text-xs text-slate-500">
          Goes through the same pipeline as a TradingView alert: saved, then queued for delivery.
        </p>
        <form onSubmit={create} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              placeholder="Symbol (BTCUSDT)"
              data-testid="admin-signal-symbol"
              className={inputClass}
            />
            <select
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
              data-testid="admin-signal-action"
              className={inputClass}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
              <option value="CLOSE">CLOSE</option>
            </select>
            <input
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="Entry price"
              inputMode="decimal"
              data-testid="admin-signal-price"
              className={inputClass}
            />
            <input
              value={form.stopLoss}
              onChange={(e) => setForm({ ...form, stopLoss: e.target.value })}
              placeholder="Stop loss"
              inputMode="decimal"
              data-testid="admin-signal-stop"
              className={inputClass}
            />
            <input
              value={form.timeframe}
              onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
              placeholder="Timeframe"
              className={inputClass}
            />
            <input
              value={form.strategy}
              onChange={(e) => setForm({ ...form, strategy: e.target.value })}
              placeholder="Strategy name"
              className={inputClass}
            />
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Note (optional)"
              className={inputClass + ' sm:col-span-2'}
            />
          </div>

          <TakeProfitEditor
            values={form.takeProfits}
            onChange={(next) => setForm({ ...form, takeProfits: next })}
            idPrefix="admin-signal"
          />

          <Button type="submit" disabled={busy} testId="admin-signal-create">
            {busy ? 'Publishing…' : 'Publish signal'}
          </Button>
        </form>
      </Panel>

      {notice ? (
        <p
          className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200"
          data-testid="admin-signal-notice"
        >
          {notice}
        </p>
      ) : null}

      {error ? <ErrorState message={error} onRetry={load} /> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => void load()} testId="admin-signals-refresh">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
        <Button variant="danger" onClick={() => void clearSamples()} testId="admin-clear-samples">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete sample data
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : signals.length === 0 ? (
        <Panel className="p-6 text-center text-sm text-slate-400">No signals yet.</Panel>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-[#1d2739]">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entry</th>
                  <th className="px-3 py-2">Take profits</th>
                  <th className="px-3 py-2">Close price</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Time (UTC)</th>
                  <th className="px-3 py-2">Manage</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.id} className="border-t border-[#1a2334]">
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{s.id}</td>
                    <td className="px-3 py-2">
                      <span className="font-bold text-slate-100">{s.symbol}</span>
                      {s.editCount > 0 ? (
                        <span className="ms-2 inline-block" data-testid={`admin-edited-${s.id}`}>
                          <Badge tone="warn">EDITED</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={s.action === 'BUY' ? 'buy' : s.action === 'SELL' ? 'sell' : 'close'}>
                        {s.action}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-300">{formatPrice(s.price)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-emerald-300" data-testid={`admin-tps-${s.id}`}>
                      {s.takeProfits && s.takeProfits.length > 0 ? s.takeProfits.map(formatPrice).join(' / ') : '—'}
                    </td>
                    <td
                      className="px-3 py-2 font-mono text-slate-300"
                      data-testid={`admin-close-price-${s.id}`}
                      title={s.status === 'CLOSED' ? 'Recorded when the signal was closed' : 'Set once the signal closes'}
                    >
                      {s.status === 'CLOSED' ? formatPrice(s.closePrice) : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-300">{s.status}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(s.signalTimestamp, 'UTC')}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(s)}
                          data-testid={`admin-edit-${s.id}`}
                          className="min-h-9 rounded-lg border border-amber-500/30 px-3 text-xs font-bold text-amber-200 hover:bg-amber-500/10"
                        >
                          Edit
                        </button>
                        {s.status === 'OPEN' ? (
                          <button
                            type="button"
                            onClick={() => {
                              const value = window.prompt('Close price for ' + s.symbol + '?') ?? '';
                              void closeSignal(s.id, value);
                            }}
                            data-testid={`admin-close-${s.id}`}
                            className="min-h-9 rounded-lg border border-[#243049] px-3 text-xs font-bold text-slate-300 hover:bg-white/5"
                          >
                            Close
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void removeSignal(s.id)}
                          data-testid={`admin-delete-${s.id}`}
                          className="min-h-9 rounded-lg border border-rose-500/30 px-3 text-xs font-bold text-rose-300 hover:bg-rose-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Close price only exists once a signal is closed — it is written by the “Close” action, by a
            TradingView CLOSE alert, or by hand in the edit dialog.
          </p>
        </>
      )}

      {editing ? (
        <EditSignalDialog
          signal={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------------------------------- logs ----------------------------------- */

function LogsTab(): React.ReactElement {
  const [deliveries, setDeliveries] = useState<DeliveryLog[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ deliveries: DeliveryLog[]; webhookEvents: WebhookEvent[] }>('/admin/logs', {
        admin: true,
      });
      setDeliveries(res.deliveries);
      setEvents(res.webhookEvents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (loading) return <Skeleton className="h-60 w-full" />;

  return (
    <div className="space-y-5" data-testid="admin-logs">
      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-100">Notification deliveries (latest 100)</h3>
        {deliveries.length === 0 ? (
          <Panel className="p-6 text-center text-sm text-slate-400">Nothing delivered yet.</Panel>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#1d2739]">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Signal</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Created (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-t border-[#1a2334]">
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{d.id}</td>
                    <td className="px-3 py-2 text-slate-200">
                      {d.action} {d.symbol}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={d.kind === 'UPDATE' ? 'warn' : 'neutral'}>
                        {d.kind === 'UPDATE' ? `UPDATE r${d.revision ?? 0}` : 'NEW'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{d.device_id}</td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          d.status === 'DELIVERED' || d.status === 'SENT'
                            ? 'buy'
                            : d.status === 'FAILED'
                              ? 'sell'
                              : 'neutral'
                        }
                      >
                        {d.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{d.reason ?? d.last_error ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-300">{d.attempts}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(d.created_at, 'UTC')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-bold text-slate-100">Webhook events (latest 50)</h3>
        {events.length === 0 ? (
          <Panel className="p-6 text-center text-sm text-slate-400">No webhook traffic yet.</Panel>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[#1d2739]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">External id</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2">Time (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-[#1a2334]">
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{e.id}</td>
                    <td className="px-3 py-2">
                      <Badge tone={e.outcome === 'ACCEPTED' ? 'buy' : e.outcome === 'DUPLICATE' ? 'neutral' : 'sell'}>
                        {e.outcome}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 break-all font-mono text-xs text-slate-400">
                      {e.external_signal_id ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{e.message}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(e.created_at, 'UTC')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- settings -------------------------------- */

function SettingsTab(): React.ReactElement {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api<{ settings: Record<string, string> }>('/admin/settings', { admin: true });
      setSettings(res.settings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the settings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    try {
      const res = await api<{ settings: Record<string, string> }>('/admin/settings', {
        method: 'POST',
        admin: true,
        body: settings,
      });
      setSettings(res.settings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the settings.');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!settings) return <Skeleton className="h-60 w-full" />;

  const fields: { key: string; label: string; hint?: string }[] = [
    { key: 'free_push_per_day', label: 'Free push notifications per day' },
    { key: 'free_visible_count', label: 'Unlocked signals for free users' },
    { key: 'history_days', label: 'Closed history window (days)' },
    { key: 'telegram_url', label: 'Telegram link' },
    { key: 'website_url', label: 'Website link' },
    { key: 'instagram_url', label: 'Instagram link' },
    { key: 'support_email', label: 'Support email' },
  ];

  return (
    <Panel className="p-5" testId="admin-settings">
      <form onSubmit={save} className="space-y-3">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-sm font-bold text-slate-200">{f.label}</span>
            <input
              value={settings[f.key] ?? ''}
              onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })}
              data-testid={'admin-setting-' + f.key}
              className={inputClass}
            />
          </label>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy} testId="admin-settings-save">
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
          {saved ? <Badge tone="pro">Saved</Badge> : null}
        </div>
      </form>
    </Panel>
  );
}

/* ----------------------------------- shell --------------------------------- */

export default function Admin(): React.ReactElement {
  const [authed, setAuthed] = useState(() => Boolean(read(KEYS.admin)));
  const [tab, setTab] = useState<Tab>('overview');

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0e17] px-4">
        <AdminLogin onDone={() => setAuthed(true)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e17]">
      <header className="border-b border-[#161f2f] px-4 py-3 safe-top sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-sm font-extrabold text-slate-100">
            <Activity className="h-5 w-5 text-sky-300" aria-hidden="true" />
            SignalDesk admin
          </span>
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-300">
            View app
          </Link>
          <button
            type="button"
            onClick={() => {
              void api('/admin/logout', { method: 'POST', admin: true }).catch(() => undefined);
              remove(KEYS.admin);
              setAuthed(false);
            }}
            data-testid="admin-logout"
            className="ms-auto inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#243049] px-3 text-sm font-bold text-slate-300 hover:bg-white/5"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6">
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 sd-scroll-x">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              data-testid={'admin-tab-' + t.id}
              className={
                'min-h-10 shrink-0 rounded-xl px-4 text-sm font-bold transition ' +
                (tab === t.id ? 'bg-sky-500 text-slate-950' : 'border border-[#243049] text-slate-400 hover:bg-white/5')
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' ? <OverviewTab /> : null}
        {tab === 'users' ? <UsersTab /> : null}
        {tab === 'signals' ? <SignalsTab /> : null}
        {tab === 'logs' ? <LogsTab /> : null}
        {tab === 'settings' ? <SettingsTab /> : null}
      </div>
    </div>
  );
}
