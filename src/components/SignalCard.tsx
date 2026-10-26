import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Lock, MinusCircle, PencilLine } from 'lucide-react';
import { Badge } from './ui';
import { formatPrice, formatTime, relativeTime } from '../lib/time';
import type { Signal } from '../lib/types';

function ActionIcon({ action }: { action: string | null }): React.ReactElement {
  if (action === 'BUY') return <ArrowUpRight className="h-4 w-4" aria-hidden="true" />;
  if (action === 'SELL') return <ArrowDownRight className="h-4 w-4" aria-hidden="true" />;
  return <MinusCircle className="h-4 w-4" aria-hidden="true" />;
}

export function LockedSignalCard({ signal }: { signal: Signal }): React.ReactElement {
  return (
    <Link
      to="/contact"
      data-testid={`signal-locked-${signal.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-[#1d2739] bg-[#0f1522] p-4 transition hover:border-sky-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <div className="sd-blur" aria-hidden="true">
        <div className="flex items-center justify-between gap-3">
          <span className="text-lg font-extrabold text-slate-100">XXXUSDT</span>
          <span className="rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-bold text-emerald-300">
            BUY
          </span>
        </div>
        <p className="mt-3 text-sm text-slate-400">Entry 00,000.00 · SL 00,000.00 · TP 00,000.00</p>
        <p className="mt-1 text-sm text-slate-500">Strategy • 1h</p>
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0b101b]/70 px-3 py-1.5 text-xs font-semibold text-slate-300 backdrop-blur">
          <Lock className="h-3.5 w-3.5 text-sky-300" aria-hidden="true" />
          Partner required
          <span className="text-sky-300 transition-transform group-hover:translate-x-0.5" aria-hidden="true">
            →
          </span>
        </span>
      </div>
    </Link>
  );
}

export function EditedBadge({ signal }: { signal: Signal }): React.ReactElement | null {
  if (!signal.editedAt || signal.editCount < 1) return null;
  return (
    <Badge tone="warn" className="uppercase">
      <PencilLine className="h-3 w-3" aria-hidden="true" />
      Edited
    </Badge>
  );
}

export default function SignalCard({
  signal,
  timezone,
}: {
  signal: Signal;
  timezone: string;
}): React.ReactElement {
  if (signal.locked) return <LockedSignalCard signal={signal} />;

  const isBuy = signal.action === 'BUY';
  const isSell = signal.action === 'SELL';
  const tone = isBuy ? 'buy' : isSell ? 'sell' : 'close';
  const pnl = signal.pnlPercent;
  const takeProfits = signal.takeProfits ?? [];
  const shown = takeProfits.slice(0, 2);
  const extra = takeProfits.length - shown.length;

  return (
    <Link
      to={`/signal/${signal.id}`}
      data-testid={`signal-card-${signal.id}`}
      className="block rounded-2xl border border-[#1d2739] bg-[#0f1522] p-4 transition hover:border-sky-500/40 hover:bg-[#121a2a] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-lg font-extrabold tracking-tight text-slate-50">
              {signal.symbol}
            </span>
            <Badge tone={tone}>
              <ActionIcon action={signal.action} />
              {signal.action}
            </Badge>
            <EditedBadge signal={signal} />
            {signal.isSample ? <Badge tone="warn">SAMPLE</Badge> : null}
          </div>
          <p className="mt-1 truncate text-sm text-slate-400">
            {signal.strategyName}
            {signal.timeframe ? ' • ' + signal.timeframe : ''}
            {signal.market ? ' • ' + signal.market : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-base font-bold text-slate-100">{formatPrice(signal.price)}</p>
          <p className="mt-0.5 text-xs text-slate-500">{formatTime(signal.signalTimestamp, timezone)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        {signal.stopLoss !== null ? (
          <span>
            SL <span className="font-mono text-rose-300">{formatPrice(signal.stopLoss)}</span>
          </span>
        ) : null}
        {shown.map((tp, index) => (
          <span key={index} data-testid={`signal-${signal.id}-tp-${index + 1}`}>
            TP{takeProfits.length > 1 ? index + 1 : ''}{' '}
            <span className="font-mono text-emerald-300">{formatPrice(tp)}</span>
          </span>
        ))}
        {extra > 0 ? (
          <span className="text-emerald-400/80" data-testid={`signal-${signal.id}-tp-more`}>
            +{extra} more
          </span>
        ) : null}
        <span className="ms-auto">{relativeTime(signal.signalTimestamp)}</span>
      </div>

      {signal.status === 'CLOSED' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#1b2436] pt-3">
          <Badge tone="neutral">CLOSED</Badge>
          {signal.result ? <Badge tone={signal.result === 'SL' ? 'sell' : 'buy'}>{signal.result}</Badge> : null}
          {signal.closePrice !== null && signal.closePrice !== undefined ? (
            <span className="text-xs text-slate-400">
              @ <span className="font-mono text-slate-200">{formatPrice(signal.closePrice)}</span>
            </span>
          ) : null}
          {pnl !== null && pnl !== undefined ? (
            <span
              className={
                'font-mono text-sm font-bold ' + (pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')
              }
            >
              {pnl >= 0 ? '+' : ''}
              {pnl}%
            </span>
          ) : null}
          <span className="ms-auto text-xs text-slate-500">
            closed {relativeTime(signal.closedAt)}
          </span>
        </div>
      ) : null}
    </Link>
  );
}
