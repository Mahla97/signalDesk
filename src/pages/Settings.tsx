import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Clock, Info, Smartphone } from 'lucide-react';
import TimezonePicker from '../components/TimezonePicker';
import { Badge, Disclaimer, Panel, SectionTitle } from '../components/ui';
import { useStore } from '../lib/store';
import { pushIsNative } from '../lib/push';
import type { NotificationPreferences } from '../lib/types';

function Toggle({
  label,
  description,
  checked,
  onChange,
  testId,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  testId: string;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <label
      className={
        'flex min-h-14 cursor-pointer items-center justify-between gap-4 border-b border-[#1a2334] py-3 last:border-0 ' +
        (disabled ? 'opacity-50' : '')
      }
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-100">{label}</span>
        <span className="block text-xs text-slate-400">{description}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
        className="h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-slate-700 transition-colors before:block before:h-5 before:w-5 before:translate-x-0.5 before:translate-y-0.5 before:rounded-full before:bg-slate-300 before:transition-transform checked:bg-sky-500 checked:before:translate-x-[1.375rem] checked:before:bg-white disabled:cursor-not-allowed"
      />
    </label>
  );
}

export default function Settings(): React.ReactElement {
  const { timezone, setTimezone, prefs, setPrefs, config, isPartner } = useStore();
  const [saved, setSaved] = useState(false);

  function update(patch: Partial<NotificationPreferences>): void {
    setPrefs({ ...prefs, ...patch });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-5">
      <SectionTitle title="Settings" subtitle="Timezone, alerts and app information" />

      <Panel className="p-5" testId="settings-timezone">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
          <Clock className="h-5 w-5 text-sky-300" aria-hidden="true" />
          Timezone
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          All signal times in the app are converted to this timezone.
        </p>
        <div className="mt-4">
          <TimezonePicker value={timezone} onChange={setTimezone} testId="settings-timezone-picker" />
        </div>
      </Panel>

      <Panel className="p-5" testId="settings-notifications">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
            <BellRing className="h-5 w-5 text-sky-300" aria-hidden="true" />
            Notifications
          </h2>
          {saved ? <Badge tone="partner">Saved</Badge> : null}
        </div>

        <div className="mt-2">
          <Toggle
            label="Enable notifications"
            description="Master switch for every alert this app sends."
            checked={prefs.notificationsEnabled}
            onChange={(v) => update({ notificationsEnabled: v })}
            testId="toggle-notifications"
          />
        </div>

        <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-400" data-testid="settings-quota">
          {isPartner
            ? 'Partner: you receive every signal in real time.'
            : `Member: the first ${config.memberVisibleCount} signals of the day are unlocked; the rest are blurred.`}
        </p>

        <p className="mt-2 flex items-start gap-2 text-xs text-slate-500">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {pushIsNative()
            ? 'Alerts are delivered as system notifications on this device.'
            : 'In the browser, alerts arrive while the app is open. In the installed Android app they arrive as system notifications.'}
        </p>
      </Panel>

      <Panel className="p-5" testId="settings-about">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
          <Info className="h-5 w-5 text-sky-300" aria-hidden="true" />
          About &amp; disclaimer
        </h2>
        <div className="mt-3">
          <Disclaimer />
        </div>
        <p className="mt-3 text-sm text-slate-400">
          Need help or want to become a Partner?{' '}
          <Link to="/contact" className="font-bold text-sky-300 hover:text-sky-200">
            Contact us
          </Link>
          .
        </p>
        <p className="mt-2 text-xs text-slate-600">SignalDesk v1.0 — signals are guidance only.</p>
      </Panel>
    </div>
  );
}
