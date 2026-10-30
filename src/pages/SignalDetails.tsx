import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Calculator as CalculatorIcon, History as HistoryIcon, Lock, PencilLine } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { Badge, Button, ErrorState, Panel, Skeleton, Disclaimer } from '../components/ui';
import { EditedBadge } from '../components/SignalCard';
import { formatDateTime, formatPrice, relativeTime } from '../lib/time';
import { useStore } from '../lib/store';
import { IS_PLAY_BUILD } from '../lib/flags';
import type { Signal } from '../lib/types';

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#1a2334] py-2.5 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className={'text-sm font-bold text-slate-100 ' + (mono ? 'font-mono' : '')}>{value}</span>
    </div>
  );
}

/** Distance from entry to a target, as a percentage — handy for sizing a trade. */
function targetPercent(entry: number | null, target: number, action: string | null): string {
  if (!entry) return '';
  const raw = ((target - entry) / entry) * 100;
  const value = action === 'SELL' ? -raw : raw;
  return (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
}

export default function SignalDetails(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { timezone, config } = useStore();
  const [signal, setSignal] = useState<Signal | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLocked(false);
    try {
      const res = await api<{ signal: Signal }>('/signals/' + id);
      setSignal(res.signal);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setLocked(true);
      } else if (err instanceof ApiError && err.status === 404) {
        setError('This signal no longer exists.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not load this signal.');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const action = signal?.action;
  const tone = action === 'BUY' ? 'buy' : action === 'SELL' ? 'sell' : 'close';
  const takeProfits = signal?.takeProfits ?? [];
  const changes = signal?.changes ?? [];

  const calculatorHref = signal
    ? '/calculator?' +
      new URLSearchParams({
        symbol: signal.symbol ?? '',
        entry: signal.price !== null ? String(signal.price) : '',
        stop: signal.stopLoss !== null ? String(signal.stopLoss) : '',
        target: takeProfits.length > 0 ? String(takeProfits[0]) : '',
        side: signal.action ?? 'BUY',
      }).toString()
    : '/calculator';

  return (
    <div className="space-y-4">
      <Link
        to="/"
        data-testid="details-back"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to signals
      </Link>

      {loading ? (
        <Panel className="space-y-3 p-5" testId="details-loading">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-24 w-full" />
        </Panel>
      ) : locked ? (
        <Panel className="p-6 text-center" testId="details-locked">
          <Lock className="mx-auto mb-3 h-8 w-8 text-sky-300" aria-hidden="true" />
          <h1 className="text-lg font-extrabold text-slate-100">This signal is for Partners</h1>
          {IS_PLAY_BUILD ? (
            <>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                Members can open the newest signals only. Partner accounts see every signal in full, in
                real time.
              </p>
              <Link to="/profile" className="mt-4 inline-block">
                <Button variant="ghost" testId="details-signin">Already a Partner? Sign in</Button>
              </Link>
            </>
          ) : (
            <>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                Members can open the newest signals only. Partners see every signal in full, in real
                time. Our team activates Partner status manually — just reach out.
              </p>
              <a href={config.telegramUrl} target="_blank" rel="noreferrer noopener" className="mt-4 inline-block">
                <Button testId="details-join">Join Our Team</Button>
              </a>
            </>
          )}
        </Panel>
      ) : error ? (
        <ErrorState message={error} onRetry={load} testId="details-error" />
      ) : signal ? (
        <>
          <Panel className="p-5" testId="details-panel">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-50" data-testid="details-symbol">
                {signal.symbol}
              </h1>
              <Badge tone={tone}>{signal.action}</Badge>
              <Badge tone={signal.status === 'OPEN' ? 'partner' : 'neutral'}>{signal.status}</Badge>
              <EditedBadge signal={signal} />
              {signal.isSample ? <Badge tone="warn">SAMPLE</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-slate-400">
              {signal.strategyName}
              {signal.timeframe ? ' • ' + signal.timeframe : ''}
              {signal.market ? ' • ' + signal.market : ''}
            </p>

            {signal.editedAt ? (
              <p
                className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-amber-100/90"
                data-testid="details-edited-notice"
              >
                <PencilLine className="h-4 w-4 shrink-0" aria-hidden="true" />
                This signal was updated {relativeTime(signal.editedAt)} ·{' '}
                {formatDateTime(signal.editedAt, timezone)}
              </p>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[#1d2739] bg-[#0c1220] p-3">
                <p className="text-xs text-slate-500">Entry</p>
                <p className="font-mono text-lg font-bold text-slate-100">{formatPrice(signal.price)}</p>
              </div>
              <div className="rounded-xl border border-[#1d2739] bg-[#0c1220] p-3">
                <p className="text-xs text-slate-500">Stop loss</p>
                <p className="font-mono text-lg font-bold text-rose-300">{formatPrice(signal.stopLoss)}</p>
              </div>
            </div>

            <div className="mt-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                Take profit {takeProfits.length > 1 ? `levels (${takeProfits.length})` : ''}
              </p>
              {takeProfits.length === 0 ? (
                <p className="rounded-xl border border-[#1d2739] bg-[#0c1220] p-3 text-sm text-slate-400">
                  No take profit level was published for this signal.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="details-take-profits">
                  {takeProfits.map((tp, index) => (
                    <div
                      key={index}
                      data-testid={`details-tp-${index + 1}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"
                    >
                      <span className="text-xs font-bold uppercase tracking-wide text-emerald-300/80">
                        TP{index + 1}
                      </span>
                      <span className="min-w-0 text-right">
                        <span className="block font-mono text-base font-bold text-emerald-200">
                          {formatPrice(tp)}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {targetPercent(signal.price, tp, signal.action)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4">
              <Row label="Signal time" value={formatDateTime(signal.signalTimestamp, timezone)} mono />
              <Row label="Received" value={`${formatDateTime(signal.receivedAt, timezone)} (${relativeTime(signal.receivedAt)})`} />
              {signal.status === 'CLOSED' ? (
                <>
                  <Row label="Closed at" value={formatDateTime(signal.closedAt, timezone)} mono />
                  <Row label="Close price" value={formatPrice(signal.closePrice)} mono />
                  <Row label="Result" value={signal.result ?? '—'} />
                  <Row
                    label="P/L"
                    value={
                      signal.pnlPercent === null || signal.pnlPercent === undefined
                        ? '—'
                        : (signal.pnlPercent >= 0 ? '+' : '') + signal.pnlPercent + '%'
                    }
                    mono
                  />
                </>
              ) : null}
              <Row label="Timezone" value={timezone} />
            </div>

            {signal.note ? (
              <p className="mt-4 rounded-xl border border-[#1d2739] bg-[#0c1220] p-3 text-sm text-slate-300">
                {signal.note}
              </p>
            ) : null}

            <Link to={calculatorHref} className="mt-4 inline-block">
              <Button variant="ghost" testId="details-calculator">
                <CalculatorIcon className="h-4 w-4" aria-hidden="true" />
                Size this trade
              </Button>
            </Link>
          </Panel>

          {changes.length > 0 ? (
            <Panel className="p-5" testId="details-changelog">
              <p className="flex items-center gap-2 text-sm font-bold text-slate-100">
                <HistoryIcon className="h-4 w-4 text-amber-300" aria-hidden="true" />
                Change history
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Every edit made after this signal was published, newest first.
              </p>
              <ul className="mt-3 space-y-2">
                {changes.map((change, index) => (
                  <li
                    key={`${change.revision}-${change.field}-${index}`}
                    data-testid={`change-row-${index}`}
                    className="rounded-xl border border-[#1d2739] bg-[#0c1220] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-200">{change.label}</span>
                      <Badge tone="neutral">rev {change.revision}</Badge>
                      <span className="ms-auto text-xs text-slate-500">
                        {formatDateTime(change.createdAt, timezone)}
                      </span>
                    </div>
                    <p className="mt-1 break-words font-mono text-sm">
                      <span className="text-rose-300/80 line-through">{change.oldValue ?? '—'}</span>
                      <span className="mx-2 text-slate-500">→</span>
                      <span className="text-emerald-300">{change.newValue ?? '—'}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Disclaimer compact />
        </>
      ) : null}
    </div>
  );
}
