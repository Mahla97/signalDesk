import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

export function Panel({
  children,
  className = '',
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className={
        'rounded-2xl border border-[#1d2739] bg-[#0f1522] shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset] ' +
        className
      }
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}): React.ReactElement {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-slate-100 sm:text-xl">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'buy' | 'sell' | 'close' | 'pro' | 'neutral' | 'warn';
  className?: string;
}): React.ReactElement {
  const tones: Record<string, string> = {
    buy: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    sell: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    close: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    pro: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    neutral: 'bg-white/5 text-slate-300 border-white/10',
  };
  return (
    <span
      className={
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wide ' +
        tones[tone] +
        ' ' +
        className
      }
    >
      {children}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }): React.ReactElement {
  return <div className={'animate-pulse rounded-lg bg-white/5 ' + className} />;
}

export function SignalSkeletonList({ count = 4 }: { count?: number }): React.ReactElement {
  return (
    <div className="space-y-3" data-testid="signals-loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-[#1d2739] bg-[#0f1522] p-4">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-14" />
          </div>
          <Skeleton className="mt-4 h-4 w-40" />
          <Skeleton className="mt-2 h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  testId,
}: {
  title: string;
  description: string;
  testId?: string;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center rounded-2xl border border-dashed border-[#243049] bg-[#0d131f] px-6 py-12 text-center"
    >
      <Inbox className="mb-3 h-8 w-8 text-slate-500" aria-hidden="true" />
      <p className="text-base font-bold text-slate-200">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-400">{description}</p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  testId = 'error-state',
}: {
  message: string;
  onRetry?: () => void;
  testId?: string;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="rounded-2xl border border-rose-500/25 bg-rose-500/5 px-5 py-6 text-center"
    >
      <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-rose-400" aria-hidden="true" />
      <p className="text-sm font-semibold text-rose-200">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          data-testid="retry-button"
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 text-sm font-bold text-rose-100 transition hover:bg-rose-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  testId,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  testId?: string;
  className?: string;
}): React.ReactElement {
  const variants: Record<string, string> = {
    primary:
      'bg-sky-500 text-slate-950 hover:bg-sky-400 focus-visible:ring-sky-300 disabled:bg-sky-500/40 disabled:text-slate-300',
    ghost:
      'border border-[#243049] bg-white/5 text-slate-200 hover:bg-white/10 focus-visible:ring-slate-400',
    danger:
      'border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 focus-visible:ring-rose-300',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed ' +
        variants[variant] +
        ' ' +
        className
      }
    >
      {children}
    </button>
  );
}

export function Disclaimer({ compact = false }: { compact?: boolean }): React.ReactElement {
  return (
    <div
      data-testid="disclaimer"
      className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm leading-relaxed text-amber-100/90"
    >
      <p className="flex items-center gap-2 font-bold text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Risk disclaimer
      </p>
      <p className="mt-2">
        Signals in this app are <strong>guidance only</strong> and are not financial advice. We do not
        execute trades and we are not a broker.
      </p>
      {compact ? null : (
        <p className="mt-2">
          Trading crypto and forex involves substantial risk and you can lose all of your capital. Every
          decision you make is your own, and we accept no responsibility for any losses.
        </p>
      )}
    </div>
  );
}
