import { useMemo, useState } from 'react';
import { Globe2, Search } from 'lucide-react';
import { deviceTimezone, formatDateTime, listTimezones, zoneOffsetLabel } from '../lib/time';

export default function TimezonePicker({
  value,
  onChange,
  testId = 'timezone-picker',
}: {
  value: string;
  onChange: (tz: string) => void;
  testId?: string;
}): React.ReactElement {
  const [query, setQuery] = useState('');
  const zones = useMemo(() => listTimezones(), []);
  const device = useMemo(() => deviceTimezone(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? zones.filter((z) => z.toLowerCase().includes(q)) : zones;
    return list.slice(0, 200);
  }, [zones, query]);

  return (
    <div data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-sm font-bold text-sky-200">
          <Globe2 className="h-4 w-4" aria-hidden="true" />
          {value} {zoneOffsetLabel(value)}
        </span>
        <button
          type="button"
          data-testid="use-device-timezone"
          onClick={() => onChange(device)}
          className="min-h-11 rounded-xl border border-[#243049] bg-white/5 px-3 text-sm font-bold text-slate-300 transition hover:bg-white/10"
        >
          Use device time ({device})
        </button>
      </div>

      <p className="mt-2 text-sm text-slate-400" data-testid="timezone-preview">
        Current time here: <span className="font-mono text-slate-200">{formatDateTime(new Date().toISOString(), value)}</span>
      </p>

      <label className="mt-4 block">
        <span className="sr-only">Search timezones</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search city or region…"
            data-testid="timezone-search"
            className="min-h-11 w-full rounded-xl border border-[#243049] bg-[#0c1220] pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          />
        </span>
      </label>

      <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-[#1d2739] bg-[#0c1220]">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No timezone matches “{query}”.</p>
        ) : (
          <ul>
            {filtered.map((zone) => (
              <li key={zone}>
                <button
                  type="button"
                  onClick={() => onChange(zone)}
                  data-testid={`tz-option-${zone}`}
                  className={
                    'flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left text-sm transition ' +
                    (zone === value
                      ? 'bg-sky-500/15 font-bold text-sky-200'
                      : 'text-slate-300 hover:bg-white/5')
                  }
                >
                  <span className="truncate">{zone.replace(/_/g, ' ')}</span>
                  <span className="shrink-0 font-mono text-xs text-slate-500">{zoneOffsetLabel(zone)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
