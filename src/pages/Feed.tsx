import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Crown, Megaphone, Radio, ShieldCheck, X } from 'lucide-react';
import SignalCard from '../components/SignalCard';
import { Badge, Button, EmptyState, ErrorState, Panel, SectionTitle, SignalSkeletonList } from '../components/ui';
import { useSignals } from '../lib/useSignals';
import { useStore } from '../lib/store';
import { IS_PLAY_BUILD } from '../lib/flags';
import { KEYS, read, write } from '../lib/storage';

function AnnouncementBanner(): React.ReactElement | null {
  const { config } = useStore();
  const [dismissedText, setDismissedText] = useState<string | null>(() => read(KEYS.dismissedAnnouncement));

  if (!config.announcementEnabled || !config.announcementText) return null;
  if (dismissedText === config.announcementText) return null;

  function dismiss(): void {
    write(KEYS.dismissedAnnouncement, config.announcementText);
    setDismissedText(config.announcementText);
  }

  return (
    <div
      className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"
      data-testid="announcement-banner"
    >
      <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-amber-100/90">{config.announcementText}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        data-testid="announcement-dismiss"
        className="rounded-lg p-1 text-amber-300/70 transition hover:bg-white/5 hover:text-amber-200"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function Feed(): React.ReactElement {
  const { timezone, isPartner, config, prefs, signalTick } = useStore();
  const { items, loading, loadingMore, error, hasMore, loadMore, reload } = useSignals('open', 15, signalTick);

  const lockedCount = items.filter((i) => i.locked).length;

  return (
    <div className="space-y-5">
      <AnnouncementBanner />

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
          <Badge tone={isPartner ? 'partner' : 'neutral'}>{isPartner ? 'PARTNER' : 'MEMBER'}</Badge>
        </div>

        {!isPartner ? (
          <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-400" data-testid="member-quota">
            Member: the first {config.memberVisibleCount} signals of the day are unlocked; the rest are blurred.
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

      {!isPartner && lockedCount > 0 ? (
        <Panel className="p-5" testId="join-panel">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300">
              <Crown className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-100">{lockedCount} signals are Partner-only</h3>
              {IS_PLAY_BUILD ? (
                <p className="mt-1 text-sm text-slate-400">
                  Partner accounts get every signal in full, in real time, with instant alerts.
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-400">
                  Partners get every signal in full, in real time, with instant alerts. Partner access is handled
                  by our team — message us on Telegram and we'll switch you over
                  (usually within 24 hours).
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {IS_PLAY_BUILD ? null : (
                  <a href={config.telegramUrl} target="_blank" rel="noreferrer noopener">
                    <Button testId="join-team">Join Our Team</Button>
                  </a>
                )}
                <Link to="/profile">
                  <Button variant="ghost" testId="join-account">Create an account</Button>
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
