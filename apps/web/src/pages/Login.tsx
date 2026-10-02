import { useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { AuthForm, type AuthMode } from '../components/AuthForm';
import { ServerAddress } from '../components/ServerAddress';
import { AppLogo, Button } from '../components/ui';
import { checkServer, continueOffline } from '../lib/auth';
import { isNative } from '../lib/platform';
import { useApp } from '../lib/store';

/** Shown whenever nobody is signed in. Google or email + password; nothing else is asked. */
export function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [retrying, setRetrying] = useState(false);
  const serverIssue = useApp((s) => s.serverIssue);
  const online = useApp((s) => s.online);

  return (
    <div className="safe-top safe-bottom relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      {/* Soft accent glow behind the card. */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-accent/15 blur-3xl" />

      <main className="relative w-full max-w-sm sm:rounded-3xl sm:border sm:border-line sm:bg-surface sm:p-8 sm:shadow-pop">
        <div className="mb-7 flex flex-col items-center text-center">
          <AppLogo size="lg" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="mt-1.5 text-sm text-ink-2">Your intelligent academic workspace</p>
        </div>

        {(serverIssue || !online) && (
          <div className="mb-5 space-y-3 rounded-2xl border border-line bg-surface-2 p-3.5 text-sm">
            <p className="flex items-start gap-2 text-ink-2">
              <CloudOff className="mt-0.5 size-4 shrink-0 text-muted" />
              {online ? serverIssue : "You're offline. Sign-in needs an internet connection."}
            </p>
            {isNative && <ServerAddress onSaved={() => void checkServer()} />}
            <div className="flex flex-wrap gap-2">
              {online && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={retrying}
                  icon={<RefreshCw className="size-3.5" />}
                  onClick={async () => {
                    setRetrying(true);
                    await checkServer();
                    setRetrying(false);
                  }}
                >
                  Try again
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void continueOffline()}>
                Use on this device only
              </Button>
            </div>
          </div>
        )}

        <AuthForm mode={mode} onModeChange={setMode} onSuccess={() => undefined} />

        <p className="mt-6 text-center text-xs text-muted">Data you already have on this device is kept and synced to your account.</p>
      </main>
    </div>
  );
}
