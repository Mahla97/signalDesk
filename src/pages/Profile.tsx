import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Crown, LogOut, Mail, ShieldAlert, Timer, UserRound } from 'lucide-react';
import { Badge, Button, Panel, SectionTitle } from '../components/ui';
import { useStore } from '../lib/store';
import { ApiError } from '../lib/api';
import { formatDateTime, formatDuration } from '../lib/time';

function AuthForm(): React.ReactElement {
  const { signIn, signUp } = useStore();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    setFieldError(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else await signUp(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'min-h-11 w-full rounded-xl border bg-[#0c1220] px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30';

  return (
    <Panel className="p-5" testId="auth-panel">
      <div className="mb-4 flex rounded-xl border border-[#243049] bg-[#0c1220] p-1">
        <button
          type="button"
          onClick={() => setMode('login')}
          data-testid="auth-tab-login"
          className={
            'min-h-10 flex-1 rounded-lg text-sm font-bold transition ' +
            (mode === 'login' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-slate-200')
          }
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode('signup')}
          data-testid="auth-tab-signup"
          className={
            'min-h-10 flex-1 rounded-lg text-sm font-bold transition ' +
            (mode === 'signup' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-slate-200')
          }
        >
          Create account
        </button>
      </div>

      <p className="mb-4 text-sm text-slate-400">
        An account is required for Pro. Free browsing works without signing up.
      </p>

      <form onSubmit={submit} noValidate>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-200">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            data-testid="auth-email"
            className={inputClass + (fieldError.email ? ' border-rose-500/60' : ' border-[#243049]')}
          />
          {fieldError.email ? (
            <span className="mt-1 block text-xs font-semibold text-rose-300" data-testid="auth-email-error">
              {fieldError.email}
            </span>
          ) : null}
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-bold text-slate-200">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder="At least 8 characters"
            data-testid="auth-password"
            className={inputClass + (fieldError.password ? ' border-rose-500/60' : ' border-[#243049]')}
          />
          {fieldError.password ? (
            <span className="mt-1 block text-xs font-semibold text-rose-300" data-testid="auth-password-error">
              {fieldError.password}
            </span>
          ) : null}
        </label>

        {error ? (
          <p
            className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200"
            data-testid="auth-error"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" className="mt-4 w-full" disabled={busy} testId="auth-submit">
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
    </Panel>
  );
}

export default function Profile(): React.ReactElement {
  const { user, isPro, signOut, refreshUser, config } = useStore();
  const [remaining, setRemaining] = useState(user?.proRemainingMs ?? 0);

  useEffect(() => {
    setRemaining(user?.proRemainingMs ?? 0);
  }, [user]);

  useEffect(() => {
    if (!user || user.proRemainingMs <= 0) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - 60000));
    }, 60000);
    return () => window.clearInterval(timer);
  }, [user]);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  if (!user) {
    return (
      <div className="space-y-5">
        <SectionTitle title="Account" subtitle="Sign in to manage your Pro membership" />
        <AuthForm />
        <Panel className="p-5">
          <h3 className="text-sm font-bold text-slate-100">Why create an account?</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-400">
            <li>• Pro membership is linked to your email address.</li>
            <li>• Your plan follows you to any device you sign in on.</li>
            <li>
              • Free browsing keeps working without an account — the first {config.freeVisibleCount} signals of the
              day are unlocked.
            </li>
          </ul>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle title="Account" subtitle="Your plan and membership status" />

      <Panel className="p-5" testId="profile-panel">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sky-500/15 text-sky-300">
            <UserRound className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate text-base font-bold text-slate-100" data-testid="profile-email">
              <Mail className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="truncate">{user.email}</span>
            </p>
            <p className="text-xs text-slate-500">Member since {formatDateTime(user.createdAt, user.timezone ?? 'UTC')}</p>
          </div>
          <Badge tone={isPro ? 'pro' : 'neutral'} className="ms-auto">
            {isPro ? 'PRO' : 'FREE'}
          </Badge>
        </div>

        {user.suspended ? (
          <p
            className="mt-4 flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200"
            data-testid="profile-suspended"
          >
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            This account is suspended. Please contact support.
          </p>
        ) : null}

        {isPro ? (
          <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/5 p-4" data-testid="profile-pro">
            <p className="flex items-center gap-2 text-sm font-bold text-sky-200">
              <Crown className="h-4 w-4" aria-hidden="true" />
              Pro membership active
            </p>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-300">
              <Timer className="h-4 w-4 text-slate-500" aria-hidden="true" />
              Remaining: <span className="font-mono font-bold text-slate-100">{formatDuration(remaining)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Expires {formatDateTime(user.proEndAt, user.timezone ?? 'UTC')}
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-[#243049] bg-[#0c1220] p-4" data-testid="profile-free">
            <p className="text-sm font-bold text-slate-100">You are on the Free plan</p>
            <p className="mt-1 text-sm text-slate-400">
              Pro members receive every signal in real time. Our team activates Pro manually.
            </p>
            <Link to="/contact" className="mt-3 inline-block">
              <Button testId="profile-upgrade">Contact us to go Pro</Button>
            </Link>
          </div>
        )}

        <Button variant="ghost" className="mt-4 w-full" onClick={() => void signOut()} testId="profile-signout">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
      </Panel>
    </div>
  );
}
