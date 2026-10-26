import { useState } from 'react';
import { BellRing, CheckCircle2, Clock } from 'lucide-react';
import TimezonePicker from '../components/TimezonePicker';
import { Button, Disclaimer, Panel } from '../components/ui';
import { useStore } from '../lib/store';
import { deviceTimezone } from '../lib/time';

export default function Onboarding(): React.ReactElement {
  const { completeOnboarding } = useStore();
  const [step, setStep] = useState<0 | 1>(0);
  const [timezone, setTimezone] = useState(() => deviceTimezone());
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a0e17] px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6">
          <img src="/logo.svg" alt="SignalDesk" className="h-16 w-auto" />
          <p className="mt-2 text-sm text-slate-400">Crypto &amp; forex trading signals, delivered fast.</p>
        </div>

        {step === 0 ? (
          <Panel className="p-5" testId="onboarding-step-disclaimer">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-100">
              <BellRing className="h-5 w-5 text-sky-300" aria-hidden="true" />
              Before you start
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              SignalDesk sends you timely BUY / SELL alerts from our strategies. We never place trades for
              you and we never touch your exchange account.
            </p>

            <div className="mt-4">
              <Disclaimer />
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-[#243049] bg-[#0c1220] p-4">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                data-testid="disclaimer-checkbox"
                className="mt-1 h-5 w-5 rounded border-slate-600 bg-transparent accent-sky-500"
              />
              <span className="text-sm text-slate-300">
                I understand that these signals are guidance only, that trading is risky, and that I am
                responsible for my own decisions.
              </span>
            </label>

            <Button
              className="mt-4 w-full"
              disabled={!agreed}
              onClick={() => setStep(1)}
              testId="onboarding-continue"
            >
              Continue
            </Button>
          </Panel>
        ) : (
          <Panel className="p-5" testId="onboarding-step-timezone">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-100">
              <Clock className="h-5 w-5 text-sky-300" aria-hidden="true" />
              Pick your timezone
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Every signal time in the app is shown in this timezone. You can change it later in Settings.
            </p>

            <div className="mt-4">
              <TimezonePicker value={timezone} onChange={setTimezone} />
            </div>

            <Button
              className="mt-5 w-full"
              onClick={() => completeOnboarding(timezone)}
              testId="onboarding-finish"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Start using SignalDesk
            </Button>
            <button
              type="button"
              onClick={() => setStep(0)}
              className="mt-3 w-full text-sm font-semibold text-slate-500 hover:text-slate-300"
              data-testid="onboarding-back"
            >
              Back
            </button>
          </Panel>
        )}
      </div>
    </div>
  );
}
