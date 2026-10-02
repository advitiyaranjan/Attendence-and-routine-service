import { useEffect } from 'react';
import { ArrowRight, Bot, SlidersHorizontal } from 'lucide-react';
import { AppLogo, Button } from '../../components/ui';
import { logout } from '../../lib/auth';
import { useSetup } from '../../lib/setup';
import { useApp } from '../../lib/store';
import { ManualSetup } from './ManualSetup';
import { PilotSetup } from './PilotSetup';

/** First-run setup for a new account: pick AI Pilot or Manual, switch any time. */
export function Setup() {
  const mode = useSetup((s) => s.mode);
  const user = useApp((s) => s.user);
  const name = useSetup((s) => s.draft.profile.name);
  const patchProfile = useSetup((s) => s.patchProfile);

  // Google accounts come with a name; use it unless the student already typed one.
  useEffect(() => {
    if (!name && user?.name) patchProfile({ name: user.name });
  }, [name, user?.name, patchProfile]);

  if (mode === 'pilot') return <PilotSetup />;
  if (mode === 'manual') return <ManualSetup />;
  return <SetupChoice />;
}

function SetupChoice() {
  const setMode = useSetup((s) => s.setMode);
  const user = useApp((s) => s.user);

  return (
    <div className="safe-top safe-bottom relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-accent/12 blur-3xl" />
      <main className="relative w-full max-w-md animate-rise">
        <div className="mb-8 text-center">
          <AppLogo size="lg" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">Welcome to your AI Academic Workspace</h1>
          <p className="mt-2 text-ink-2">Let's set everything up. How would you like to begin?</p>
        </div>

        <div className="space-y-3">
          <ChoiceCard
            icon={<Bot className="size-6" />}
            title="AI Pilot"
            badge="Recommended"
            body="Let AI set everything up with you, step by step."
            onClick={() => setMode('pilot')}
          />
          <ChoiceCard icon={<SlidersHorizontal className="size-6" />} title="Manual Setup" body="I'll configure everything myself." onClick={() => setMode('manual')} />
        </div>

        <p className="mt-6 text-center text-sm text-muted">You can switch anytime.</p>
        {user && (
          <p className="mt-8 text-center text-xs text-muted">
            Signed in as {user.email ?? user.name} ·{' '}
            <Button variant="ghost" size="sm" className="h-auto px-1 py-0 text-xs" onClick={() => void logout(false)}>
              Sign out
            </Button>
          </p>
        )}
      </main>
    </div>
  );
}

function ChoiceCard({ icon, title, body, badge, onClick }: { icon: React.ReactNode; title: string; body: string; badge?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition-all hover:border-accent/50 hover:shadow-pop active:scale-[0.99] sm:p-5"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-semibold">
          {title}
          {badge && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">{badge}</span>}
        </span>
        <span className="mt-0.5 block text-sm text-ink-2">{body}</span>
      </span>
      <ArrowRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
    </button>
  );
}
