import { Globe, Instagram, Mail, MessageCircle, Sparkles } from 'lucide-react';
import { Disclaimer, Panel, SectionTitle } from '../components/ui';
import { useStore } from '../lib/store';

type LinkCardProps = {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
  accent: string;
};

function LinkCard({ href, title, description, icon: Icon, testId, accent }: LinkCardProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      data-testid={testId}
      className="flex min-h-16 items-center gap-4 rounded-2xl border border-[#1d2739] bg-[#0f1522] p-4 transition hover:border-sky-500/40 hover:bg-[#121a2a] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <span className={'grid h-11 w-11 shrink-0 place-items-center rounded-xl ' + accent}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-100">{title}</span>
        <span className="block truncate text-xs text-slate-400">{description}</span>
      </span>
    </a>
  );
}

export default function Contact(): React.ReactElement {
  const { config } = useStore();

  return (
    <div className="space-y-5">
      <SectionTitle title="Contact us" subtitle="Questions, support, or joining our team" />

      <Panel className="p-5" testId="join-info">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-100">
          <Sparkles className="h-5 w-5 text-sky-300" aria-hidden="true" />
          How to become a Partner
        </h2>
        <ol className="mt-3 space-y-2 text-sm text-slate-300">
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-500/15 text-xs font-bold text-sky-300">1</span>
            Create an account in the app with your email.
          </li>
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-500/15 text-xs font-bold text-sky-300">2</span>
            Message us on Telegram or through our website with that email address.
          </li>
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-500/15 text-xs font-bold text-sky-300">3</span>
            Our team activates Partner status on your account — usually within 24 hours.
          </li>
        </ol>
        {/*<p className="mt-3 text-xs text-slate-500">*/}
        {/*  Partner activation is handled by our team.*/}
        {/*</p>*/}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <LinkCard
          href={config.telegramUrl}
          title="Telegram"
          description={config.telegramUrl}
          icon={MessageCircle}
          testId="contact-telegram"
          accent="bg-sky-500/15 text-sky-300"
        />
        <LinkCard
          href={config.websiteUrl}
          title="Website"
          description={config.websiteUrl}
          icon={Globe}
          testId="contact-website"
          accent="bg-emerald-500/15 text-emerald-300"
        />
        <LinkCard
          href={config.instagramUrl}
          title="Instagram"
          description={config.instagramUrl}
          icon={Instagram}
          testId="contact-instagram"
          accent="bg-fuchsia-500/15 text-fuchsia-300"
        />
        <LinkCard
          href={'mailto:' + config.supportEmail}
          title="Email"
          description={config.supportEmail}
          icon={Mail}
          testId="contact-email"
          accent="bg-amber-500/15 text-amber-300"
        />
      </div>

      <Disclaimer compact />
    </div>
  );
}
