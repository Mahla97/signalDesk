import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { Button, Panel } from '../components/ui';
import { useStore } from '../lib/store';
import { ApiError } from '../lib/api';

export default function ResetPassword(): React.ReactElement {
  const { resetPassword } = useStore();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('This reset link is invalid.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    'min-h-11 w-full rounded-xl border bg-[#0c1220] px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30';

  return (
    <div className="min-h-screen bg-[#0a0e17] px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <Panel className="p-6" testId="reset-password-panel">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-500/15 text-sky-300">
            <KeyRound className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-lg font-extrabold text-slate-100">Choose a new password</h1>

          {done ? (
            <div className="mt-4">
              <p className="text-sm text-slate-300">
                Your password has been reset. You can now sign in with it.
              </p>
              <Button className="mt-4 w-full" onClick={() => navigate('/profile')} testId="reset-to-signin">
                Sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mt-4">
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-200">New password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  data-testid="reset-password-input"
                  className={inputClass + ' border-[#243049]'}
                />
              </label>
              <label className="mt-3 block">
                <span className="mb-1 block text-sm font-bold text-slate-200">Confirm password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Repeat it"
                  data-testid="reset-password-confirm"
                  className={inputClass + ' border-[#243049]'}
                />
              </label>

              {error ? (
                <p
                  className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200"
                  data-testid="reset-password-error"
                >
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="mt-4 w-full" disabled={busy} testId="reset-password-submit">
                {busy ? 'Please wait…' : 'Reset password'}
              </Button>

              <Link
                to="/profile"
                className="mt-3 block text-center text-sm font-semibold text-slate-500 hover:text-slate-300"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </Panel>
      </div>
    </div>
  );
}
