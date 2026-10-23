import { Link } from 'react-router-dom';
import { Bell, Crown, Radio, ShieldCheck } from 'lucide-react';
import SignalCard from '../components/SignalCard';
import { Badge, Button, EmptyState, ErrorState, Panel, SectionTitle, SignalSkeletonList } from '../components/ui';
import { useSignals } from '../lib/useSignals';
import { useStore } from '../lib/store';

export default function Feed(): React.ReactElement {
  const { timezone, isPro, config, prefs, signalTick } = useStore();
  const { items, loading, loadingMore, error, hasMore, loadMore, reload } = useSignals('open', 15, signalTick);

  const lockedCount = items.filter((i) => i.locked).length;

  return (
    <div className="space-y-5">
      <Panel className="p-4" testId="status-panel">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-300 sd-live-dot">
            <Radio className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-100">Live signal feed</p>
            <p className="truncate text-xs text-slate-400">
              Times shown in <span className="font-mono text-slate-300">{timezone}</span>
              {prefs.notificationsEnabled ? ' • alerts on' : ' • alerts off'}
            </p>
          </div>
          <Badge tone={isPro ? 'pro' : 'neutral'}>{isPro ? 'PRO' : 'FREE'}</Badge>
        </div>

        {!isPro ? (
          <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-400" data-testid="free-quota">
            Free plan: the first {config.freeVisibleCount} signals of the day are unlocked; the rest are blurred.
          </p>
        ) : null}
      </Panel>

      <div>
        <SectionTitle
          title="Open signals"
          subtitle="Newest first"
          right={
            <Link
              to="/history"
              data-testid="feed-history-link"
              className="text-sm font-bold text-sky-300 hover:text-sky-200"
            >
              Closed history →
            </Link>
          }
        />

        {loading ? (
          <SignalSkeletonList />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} testId="feed-error" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No open signals right now"
            description="New signals appear here the moment our strategies fire. Keep notifications on so you don't miss them."
            testId="feed-empty"
          />
        ) : (
          <div className="space-y-3" data-testid="feed-list">
            {items.map((signal) => (
              <SignalCard key={signal.id} signal={signal} timezone={timezone} />
            ))}
          </div>
        )}

        {hasMore && !loading && !error ? (
          <Button
            variant="ghost"
            className="mt-4 w-full"
            onClick={loadMore}
            disabled={loadingMore}
            testId="feed-load-more"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        ) : null}
      </div>

      {!isPro && lockedCount > 0 ? (
        <Panel className="p-5" testId="upgrade-panel">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300">
              <Crown className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-100">{lockedCount} signals are Pro-only</h3>
              <p className="mt-1 text-sm text-slate-400">
                Pro members get every signal in full, in real time, with instant alerts. Upgrades are handled
                by our team — message us on Telegram or through the website and you'll be switched over
                (usually within 24 hours).
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/contact">
                  <Button testId="upgrade-contact">Contact us to go Pro</Button>
                </Link>
                <Link to="/profile">
                  <Button variant="ghost" testId="upgrade-account">Create an account</Button>
                </Link>
              </div>
            </div>
          </div>
        </Panel>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <Bell className="h-4 w-4 text-sky-300" aria-hidden="true" />
            Alerts
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Manage notification types and your timezone in{' '}
            <Link to="/settings" className="font-bold text-sky-300 hover:text-sky-200">
              Settings
            </Link>
            .
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-200">
            <ShieldCheck className="h-4 w-4 text-amber-300" aria-hidden="true" />
            Guidance only
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Not financial advice. Trading involves risk — read the full disclaimer in Settings.
          </p>
        </Panel>
      </div>
    </div>
  );
}
