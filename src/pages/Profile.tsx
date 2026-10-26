import { useEffect, useState, type FormEvent } from 'react';
import { Crown, LogOut, Mail, ShieldAlert, Timer, UserRound } from 'lucide-react';
import { Badge, Button, Panel, SectionTitle } from '../components/ui';
import { useStore } from '../lib/store';
import { ApiError } from '../lib/api';
import { formatDateTime, formatDuration } from '../lib/time';

function AuthForm(): React.ReactElement {
  const { signIn, signUp, requestPasswordReset } = useStore();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  function switchMode(next: 'login' | 'signup' | 'forgot'): void {
    setMode(next);
    setFieldError({});
    setError(null);
    setSent(false);
    setPassword('');
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (mode !== 'forgot' && password.length < 8) errors.password = 'Password must be at least 8 characters.';
    setFieldError(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await signIn(email.trim(), password);
      else if (mode === 'signup') await signUp(email.trim(), password);
      else {
        await requestPasswordReset(email.trim());
        setSent(true);
      }
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
          onClick={() => switchMode('login')}
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
          onClick={() => switchMode('signup')}
          data-testid="auth-tab-signup"
          className={
            'min-h-10 flex-1 rounded-lg text-sm font-bold transition ' +
            (mode === 'signup' ? 'bg-sky-500 text-slate-950' : 'text-slate-400 hover:text-slate-200')
          }
        >
          Create account
        </button>
      </div>

      {mode === 'forgot' ? (
        <p className="mb-4 text-sm text-slate-400">
          Enter the email you signed up with and we'll send you a reset link.
        </p>
      ) : (
        <p className="mb-4 text-sm text-slate-400">
          An account is required for Partner status. You can browse without signing up.
        </p>
      )}

      {sent ? (
        <div
          className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200"
          data-testid="auth-reset-sent"
        >
          If an account exists for that email, a reset link is on its way.
        </div>
      ) : (
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

          {mode !== 'forgot' ? (
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
          ) : null}

          {error ? (
            <p
              className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200"
              data-testid="auth-error"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" className="mt-4 w-full" disabled={busy} testId="auth-submit">
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </Button>
        </form>
      )}

      {mode === 'login' ? (
        <button
          type="button"
          onClick={() => switchMode('forgot')}
          data-testid="auth-forgot"
          className="mt-3 w-full text-sm font-semibold text-slate-500 hover:text-slate-300"
        >
          Forgot password?
        </button>
      ) : null}
    </Panel>
  );
}

export default function Profile(): React.ReactElement {
  const { user, isPartner, signOut, deleteAccount, refreshUser, config } = useStore();
  const [remaining, setRemaining] = useState(user?.partnerRemainingMs ?? 0);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete(): Promise<void> {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete your account. Please try again.');
      setDeleting(false);
    }
  }

  useEffect(() => {
    setRemaining(user?.partnerRemainingMs ?? 0);
  }, [user]);

  useEffect(() => {
    if (!user || user.partnerRemainingMs <= 0) return;
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
        <SectionTitle title="Account" subtitle="Sign in to manage your Partner status" />
        <AuthForm />
        <Panel className="p-5">
          <h3 className="text-sm font-bold text-slate-100">Why create an account?</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-400">
            <li>• Partner status is linked to your email address.</li>
            <li>• Your Partner status follows you to any device you sign in on.</li>
            <li>
              • You can keep browsing without an account — the first {config.memberVisibleCount} signals of the
              day are unlocked.
            </li>
          </ul>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle title="Account" subtitle="Your Partner status" />

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
          <Badge tone={isPartner ? 'partner' : 'neutral'} className="ms-auto">
            {isPartner ? 'PARTNER' : 'MEMBER'}
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

        {isPartner ? (
          <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/5 p-4" data-testid="profile-partner">
            <p className="flex items-center gap-2 text-sm font-bold text-sky-200">
              <Crown className="h-4 w-4" aria-hidden="true" />
              Partner status active
            </p>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-300">
              <Timer className="h-4 w-4 text-slate-500" aria-hidden="true" />
              Remaining: <span className="font-mono font-bold text-slate-100">{formatDuration(remaining)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Expires {formatDateTime(user.partnerEndAt, user.timezone ?? 'UTC')}
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-[#243049] bg-[#0c1220] p-4" data-testid="profile-member">
            <p className="text-sm font-bold text-slate-100">You are a Member</p>
            <p className="mt-1 text-sm text-slate-400">
              Partners receive every signal in real time. Our team activates Partner status manually.
            </p>
            <a href={config.telegramUrl} target="_blank" rel="noreferrer noopener" className="mt-3 inline-block">
              <Button testId="profile-join">Join Our Team</Button>
            </a>
          </div>
        )}

        <Button variant="ghost" className="mt-4 w-full" onClick={() => void signOut()} testId="profile-signout">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>

        {showDelete ? (
          <div className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/5 p-4" data-testid="profile-delete-confirm">
            <p className="text-sm font-bold text-rose-200">Delete your account?</p>
            <p className="mt-1 text-xs text-slate-400">
              This permanently removes your account, your Partner status and your sign-in. This cannot be undone.
            </p>
            {deleteError ? (
              <p className="mt-2 text-xs font-semibold text-rose-300">{deleteError}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="danger"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                testId="profile-delete-confirm-btn"
              >
                {deleting ? 'Deleting…' : 'Delete my account'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowDelete(false)}
                disabled={deleting}
                testId="profile-delete-cancel"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            data-testid="profile-delete"
            className="mt-3 w-full text-center text-sm font-semibold text-rose-400/80 hover:text-rose-300"
          >
            Delete account
          </button>
        )}
      </Panel>
    </div>
  );
}
