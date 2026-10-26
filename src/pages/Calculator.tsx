import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Calculator as CalculatorIcon, RotateCcw } from 'lucide-react';
import { Badge, Button, Disclaimer, Panel, SectionTitle } from '../components/ui';

type Side = 'BUY' | 'SELL';
type Market = 'CRYPTO' | 'FOREX';

type Form = {
  market: Market;
  side: Side;
  symbol: string;
  balance: string;
  riskPercent: string;
  entry: string;
  stop: string;
  target: string;
  leverage: string;
  pipSize: string;
  pipValue: string;
};

const STORAGE_KEY = 'signaldesk.calculator.v1';

const DEFAULT_FORM: Form = {
  market: 'CRYPTO',
  side: 'BUY',
  symbol: '',
  balance: '1000',
  riskPercent: '1',
  entry: '',
  stop: '',
  target: '',
  leverage: '10',
  pipSize: '0.0001',
  pipValue: '10',
};

const inputClass =
  'min-h-11 w-full rounded-xl border border-[#243049] bg-[#0c1220] px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/30';

function num(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function units(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

function loadSaved(): Partial<Form> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Form>;
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-slate-200">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
  testId,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad' | 'accent';
  testId?: string;
}): React.ReactElement {
  const tones: Record<string, string> = {
    default: 'text-slate-100',
    good: 'text-emerald-300',
    bad: 'text-rose-300',
    accent: 'text-sky-300',
  };
  return (
    <div className="rounded-xl border border-[#1d2739] bg-[#0c1220] p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={'mt-0.5 break-words font-mono text-lg font-bold ' + tones[tone]} data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

export default function Calculator(): React.ReactElement {
  const [searchParams] = useSearchParams();

  const [form, setForm] = useState<Form>(() => {
    const saved = loadSaved();
    const base: Form = { ...DEFAULT_FORM, ...saved };
    const symbol = searchParams.get('symbol');
    const entry = searchParams.get('entry');
    const stop = searchParams.get('stop');
    const target = searchParams.get('target');
    const side = searchParams.get('side');
    if (symbol) {
      base.symbol = symbol;
      const upper = symbol.toUpperCase();
      base.market = /USDT|USDC|BUSD|PERP/.test(upper) ? 'CRYPTO' : 'FOREX';
      if (/JPY|XAU|XAG/.test(upper)) base.pipSize = '0.01';
    }
    if (entry) base.entry = entry;
    if (stop) base.stop = stop;
    if (target) base.target = target;
    if (side === 'BUY' || side === 'SELL') base.side = side;
    return base;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          market: form.market,
          balance: form.balance,
          riskPercent: form.riskPercent,
          leverage: form.leverage,
          pipSize: form.pipSize,
          pipValue: form.pipValue,
        }),
      );
    } catch {
      /* private mode — the calculator still works, it just won't remember */
    }
  }, [form.market, form.balance, form.riskPercent, form.leverage, form.pipSize, form.pipValue]);

  function update<K extends keyof Form>(key: K, value: Form[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const result = useMemo(() => {
    const balance = num(form.balance);
    const riskPercent = num(form.riskPercent);
    const entry = num(form.entry);
    const stop = num(form.stop);
    const target = num(form.target);
    const leverage = num(form.leverage);
    const pipSize = num(form.pipSize);
    const pipValue = num(form.pipValue);

    const warnings: string[] = [];
    const ready =
      balance !== null &&
      balance > 0 &&
      riskPercent !== null &&
      riskPercent > 0 &&
      entry !== null &&
      entry > 0 &&
      stop !== null &&
      stop > 0;

    if (balance !== null && balance <= 0) warnings.push('Account balance must be greater than zero.');
    if (riskPercent !== null && riskPercent > 5) {
      warnings.push('Risking more than 5% of the account on one trade is very aggressive.');
    }
    if (entry !== null && stop !== null && entry === stop) {
      warnings.push('Entry and stop loss are identical — there is no risk distance to size against.');
    }
    if (entry !== null && stop !== null && entry !== stop) {
      if (form.side === 'BUY' && stop > entry) warnings.push('For a BUY, the stop loss should sit below the entry.');
      if (form.side === 'SELL' && stop < entry) warnings.push('For a SELL, the stop loss should sit above the entry.');
    }
    if (entry !== null && target !== null) {
      if (form.side === 'BUY' && target < entry) warnings.push('For a BUY, the take profit should sit above the entry.');
      if (form.side === 'SELL' && target > entry) warnings.push('For a SELL, the take profit should sit below the entry.');
    }

    if (!ready || entry === stop) {
      return { ready: false as const, warnings };
    }

    const riskAmount = (balance as number) * ((riskPercent as number) / 100);
    const stopDistance = Math.abs((entry as number) - (stop as number));
    const stopPercent = (stopDistance / (entry as number)) * 100;

    // Crypto/spot style: size in units of the base asset.
    const positionUnits = riskAmount / stopDistance;
    const notional = positionUnits * (entry as number);

    // Forex style: size in standard lots from pips and the pip value per lot.
    const pip = pipSize && pipSize > 0 ? pipSize : 0.0001;
    const pipsAtRisk = stopDistance / pip;
    const perLot = pipValue && pipValue > 0 ? pipValue : 10;
    const lots = pipsAtRisk > 0 ? riskAmount / (pipsAtRisk * perLot) : 0;

    const lev = leverage && leverage > 0 ? leverage : 1;
    const requiredMargin = notional / lev;

    let reward: number | null = null;
    let rr: number | null = null;
    if (target !== null && target > 0) {
      const rewardDistance = Math.abs(target - (entry as number));
      reward = positionUnits * rewardDistance;
      rr = stopDistance > 0 ? rewardDistance / stopDistance : null;
    }

    if (form.market === 'CRYPTO' && requiredMargin > (balance as number)) {
      warnings.push(
        'The required margin is larger than the account balance — lower the risk, widen the stop, or raise the leverage.',
      );
    }

    return {
      ready: true as const,
      warnings,
      riskAmount,
      stopDistance,
      stopPercent,
      positionUnits,
      notional,
      requiredMargin,
      pipsAtRisk,
      lots,
      reward,
      rr,
      balance: balance as number,
    };
  }, [form]);

  const isForex = form.market === 'FOREX';

  return (
    <div className="space-y-5">
      <Panel className="p-4" testId="calculator-intro">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300">
            <CalculatorIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-100">Position size calculator</p>
            <p className="text-xs text-slate-400">
              Work out how large a trade can be while risking a fixed slice of your account.
            </p>
          </div>
          {form.symbol ? <Badge tone="partner">{form.symbol}</Badge> : null}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle title="Your trade" subtitle="All values in your account currency" />
          <Panel className="space-y-3 p-4" testId="calculator-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Market">
                <div className="flex gap-2">
                  {(['CRYPTO', 'FOREX'] as Market[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => update('market', m)}
                      data-testid={'calc-market-' + m.toLowerCase()}
                      className={
                        'min-h-11 flex-1 rounded-xl border px-3 text-sm font-bold transition ' +
                        (form.market === m
                          ? 'border-sky-500/50 bg-sky-500/15 text-sky-200'
                          : 'border-[#243049] text-slate-400 hover:bg-white/5')
                      }
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Direction">
                <div className="flex gap-2">
                  {(['BUY', 'SELL'] as Side[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => update('side', s)}
                      data-testid={'calc-side-' + s.toLowerCase()}
                      className={
                        'min-h-11 flex-1 rounded-xl border px-3 text-sm font-bold transition ' +
                        (form.side === s
                          ? s === 'BUY'
                            ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                            : 'border-rose-500/50 bg-rose-500/15 text-rose-200'
                          : 'border-[#243049] text-slate-400 hover:bg-white/5')
                      }
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Account balance">
                <input
                  value={form.balance}
                  onChange={(e) => update('balance', e.target.value)}
                  inputMode="decimal"
                  placeholder="1000"
                  data-testid="calc-balance"
                  className={inputClass}
                />
              </Field>

              <Field label="Risk per trade (%)">
                <input
                  value={form.riskPercent}
                  onChange={(e) => update('riskPercent', e.target.value)}
                  inputMode="decimal"
                  placeholder="1"
                  data-testid="calc-risk"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              {['0.5', '1', '2', '3'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => update('riskPercent', r)}
                  data-testid={'calc-risk-' + r.replace('.', '_')}
                  className="min-h-9 rounded-lg border border-[#243049] px-3 text-xs font-bold text-slate-300 transition hover:bg-white/5"
                >
                  {r}%
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Entry price">
                <input
                  value={form.entry}
                  onChange={(e) => update('entry', e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  data-testid="calc-entry"
                  className={inputClass}
                />
              </Field>
              <Field label="Stop loss">
                <input
                  value={form.stop}
                  onChange={(e) => update('stop', e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  data-testid="calc-stop"
                  className={inputClass}
                />
              </Field>
              <Field label="Take profit" hint="Optional — used for reward/risk">
                <input
                  value={form.target}
                  onChange={(e) => update('target', e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  data-testid="calc-target"
                  className={inputClass}
                />
              </Field>
            </div>

            {isForex ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Pip size" hint="0.0001 for most pairs, 0.01 for JPY and gold">
                  <input
                    value={form.pipSize}
                    onChange={(e) => update('pipSize', e.target.value)}
                    inputMode="decimal"
                    data-testid="calc-pip-size"
                    className={inputClass}
                  />
                </Field>
                <Field label="Pip value per standard lot" hint="Usually $10 for a 1.0 lot on USD pairs">
                  <input
                    value={form.pipValue}
                    onChange={(e) => update('pipValue', e.target.value)}
                    inputMode="decimal"
                    data-testid="calc-pip-value"
                    className={inputClass}
                  />
                </Field>
              </div>
            ) : (
              <Field label="Leverage" hint="Used only to estimate the margin your broker will hold">
                <input
                  value={form.leverage}
                  onChange={(e) => update('leverage', e.target.value)}
                  inputMode="decimal"
                  data-testid="calc-leverage"
                  className={inputClass}
                />
              </Field>
            )}

            <Button
              variant="ghost"
              onClick={() => setForm({ ...DEFAULT_FORM, market: form.market })}
              testId="calc-reset"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset
            </Button>
          </Panel>
        </div>

        <div>
          <SectionTitle title="Result" subtitle="Recalculates as you type" />
          {!result.ready ? (
            <Panel className="p-6 text-center" testId="calculator-empty">
              <CalculatorIcon className="mx-auto mb-3 h-8 w-8 text-slate-500" aria-hidden="true" />
              <p className="text-base font-bold text-slate-200">Fill in the trade</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-slate-400">
                Enter a balance, a risk percentage, an entry and a stop loss — the position size appears here.
              </p>
            </Panel>
          ) : (
            <Panel className="space-y-3 p-4" testId="calculator-result">
              <div className="grid gap-3 sm:grid-cols-2">
                <Stat label="Amount at risk" value={money(result.riskAmount)} tone="bad" testId="calc-out-risk" />
                <Stat
                  label="Stop distance"
                  value={`${units(result.stopDistance)} (${result.stopPercent.toFixed(2)}%)`}
                  testId="calc-out-distance"
                />
                {isForex ? (
                  <>
                    <Stat label="Position size (lots)" value={units(result.lots)} tone="accent" testId="calc-out-size" />
                    <Stat label="Pips at risk" value={result.pipsAtRisk.toFixed(1)} testId="calc-out-pips" />
                  </>
                ) : (
                  <>
                    <Stat
                      label="Position size (units)"
                      value={units(result.positionUnits)}
                      tone="accent"
                      testId="calc-out-size"
                    />
                    <Stat label="Position value" value={money(result.notional)} testId="calc-out-notional" />
                    <Stat label="Required margin" value={money(result.requiredMargin)} testId="calc-out-margin" />
                  </>
                )}
                {result.reward !== null ? (
                  <Stat label="Potential profit" value={money(result.reward)} tone="good" testId="calc-out-reward" />
                ) : null}
                {result.rr !== null ? (
                  <Stat label="Reward / risk" value={result.rr.toFixed(2) + ' : 1'} tone="good" testId="calc-out-rr" />
                ) : null}
              </div>

              <p className="rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-400">
                Sized so a stop-out costs {money(result.riskAmount)} — {form.riskPercent}% of a{' '}
                {money(result.balance)} account. Spread, commission, funding and slippage are not included.
              </p>
            </Panel>
          )}

          {result.warnings.length > 0 ? (
            <div
              className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4"
              data-testid="calculator-warnings"
            >
              <p className="flex items-center gap-2 text-sm font-bold text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                Check this
              </p>
              <ul className="mt-2 space-y-1 text-sm text-amber-100/90">
                {result.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <Disclaimer compact />
    </div>
  );
}
