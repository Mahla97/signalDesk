import SignalCard from '../components/SignalCard';
import { Button, EmptyState, ErrorState, Panel, SectionTitle, SignalSkeletonList } from '../components/ui';
import { useSignals } from '../lib/useSignals';
import { useStore } from '../lib/store';

export default function History(): React.ReactElement {
  const { timezone, config } = useStore();
  const { items, loading, loadingMore, error, hasMore, total, loadMore, reload } = useSignals('closed');

  const wins = items.filter((i) => (i.pnlPercent ?? 0) > 0 || i.result === 'TP').length;
  const losses = items.filter((i) => (i.pnlPercent ?? 0) < 0 || i.result === 'SL').length;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Closed signals"
        subtitle={`Every closed signal from the last ${config.historyDays} days — free for everyone.`}
      />

      <div className="grid grid-cols-3 gap-3">
        <Panel className="p-3 text-center" testId="history-total">
          <p className="text-xs text-slate-500">Closed</p>
          <p className="text-xl font-extrabold text-slate-100">{total}</p>
        </Panel>
        <Panel className="p-3 text-center" testId="history-wins">
          <p className="text-xs text-slate-500">On this page: TP</p>
          <p className="text-xl font-extrabold text-emerald-400">{wins}</p>
        </Panel>
        <Panel className="p-3 text-center" testId="history-losses">
          <p className="text-xs text-slate-500">On this page: SL</p>
          <p className="text-xl font-extrabold text-rose-400">{losses}</p>
        </Panel>
      </div>

      {loading ? (
        <SignalSkeletonList count={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} testId="history-error" />
      ) : items.length === 0 ? (
        <EmptyState
          title="No closed signals yet"
          description={`Signals closed in the last ${config.historyDays} days will be listed here with their result.`}
          testId="history-empty"
        />
      ) : (
        <div className="space-y-3" data-testid="history-list">
          {items.map((signal) => (
            <SignalCard key={signal.id} signal={signal} timezone={timezone} />
          ))}
        </div>
      )}

      {hasMore && !loading && !error ? (
        <Button
          variant="ghost"
          className="w-full"
          onClick={loadMore}
          disabled={loadingMore}
          testId="history-load-more"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
