import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  Activity,
  Bell,
  Calculator,
  History,
  LifeBuoy,
  Settings,
  UserRound,
  X,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { Badge } from './ui';

const NAV = [
  { to: '/', label: 'Signals', short: 'Signals', icon: Activity, testId: 'nav-signals', end: true },
  { to: '/history', label: 'History', short: 'History', icon: History, testId: 'nav-history', end: false },
  { to: '/calculator', label: 'Calculator', short: 'Calc', icon: Calculator, testId: 'nav-calculator', end: false },
  { to: '/contact', label: 'Contact', short: 'Contact', icon: LifeBuoy, testId: 'nav-contact', end: false },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings, testId: 'nav-settings', end: false },
  { to: '/profile', label: 'Account', short: 'Account', icon: UserRound, testId: 'nav-profile', end: false },
];

function Toasts(): React.ReactElement | null {
  const { toasts, dismissToast } = useStore();
  const navigate = useNavigate();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex flex-col items-center gap-2 px-3 safe-top">
      {toasts.slice(0, 3).map((toast) => (
        <div
          key={toast.id}
          data-testid={`toast-${toast.signalId}`}
          className={
            'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border bg-[#0f1726] p-3 shadow-xl ' +
            (toast.kind === 'UPDATE' ? 'border-amber-500/40' : toast.kind === 'DELETE' ? 'border-rose-500/40' : 'border-sky-500/30')
          }
        >
          <Bell
            className={
              'h-5 w-5 shrink-0 ' +
              (toast.kind === 'UPDATE' ? 'text-amber-300' : toast.kind === 'DELETE' ? 'text-rose-300' : 'text-sky-300')
            }
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => {
              dismissToast(toast.id);
              if (toast.kind !== 'DELETE') navigate('/signal/' + toast.signalId);
            }}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-sm font-bold text-slate-100">{toast.title}</p>
            <p className="truncate text-xs text-slate-400">{toast.body}</p>
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }): React.ReactElement {
  const { isPartner } = useStore();

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0e17]">
      <Toasts />

      <header className="sticky top-0 z-40 border-b border-[#161f2f] bg-[#0a0e17]/95 backdrop-blur safe-top">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-500/15 text-sky-300">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-base font-extrabold tracking-tight text-slate-50">SignalDesk</span>
          </Link>

          <nav className="ms-auto hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-testid={item.testId + '-desktop'}
                className={({ isActive }) =>
                  'rounded-lg px-3 py-2 text-sm font-bold transition ' +
                  (isActive ? 'bg-sky-500/15 text-sky-300' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ms-auto md:ms-0">
            <Badge tone={isPartner ? 'partner' : 'neutral'} className="uppercase">
              {isPartner ? 'PARTNER' : 'MEMBER'}
            </Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 sm:px-6 md:pb-10 lg:px-8">
        {children}
      </main>

      <footer className="hidden border-t border-[#161f2f] px-4 py-6 text-center text-xs text-slate-600 md:block">
        <p>SignalDesk — guidance only, not financial advice. Trading involves risk.</p>
      </footer>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#161f2f] bg-[#0b1120]/98 backdrop-blur md:hidden safe-bottom">
        <div className="mx-auto flex w-full max-w-lg items-stretch justify-between px-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-testid={item.testId}
              className={({ isActive }) =>
                'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 pt-1 text-[10px] font-bold transition ' +
                (isActive ? 'text-sky-300' : 'text-slate-500')
              }
            >
              <item.icon className="h-5 w-5" aria-hidden="true" />
              <span className="w-full truncate text-center">{item.short}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
