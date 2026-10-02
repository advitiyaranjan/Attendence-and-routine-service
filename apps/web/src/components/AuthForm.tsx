import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/api';
import { login, loginWithGoogle, register } from '../lib/auth';
import { isNative } from '../lib/platform';
import { toast, useApp } from '../lib/store';
import { ServerAddress } from './ServerAddress';
import { Button, Field, Input, Tabs } from './ui';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(opts: { client_id: string; callback: (r: { credential: string }) => void }): void;
          renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
        };
      };
    };
  }
}

function GoogleButton({ clientId, onSuccess }: { clientId: string; onSuccess: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.google || !ref.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try {
            await loginWithGoogle(credential);
            onSuccess();
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        },
      });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 280, text: 'continue_with' });
    };
    if (window.google) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => {
      cancelled = true;
    };
  }, [clientId, onSuccess]);
  return <div ref={ref} className="flex justify-center" />;
}

export function AuthForm({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleClientId = useApp((s) => s.googleClientId);
  const online = useApp((s) => s.online);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name || undefined);
      toast('Signed in. Syncing your data…', 'success');
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!online) return <p className="text-sm text-ink-2">Signing in needs an internet connection. You can keep using the app locally.</p>;

  return (
    <div className="space-y-4">
      {isNative && <ServerAddress />}
      <Tabs
        value={mode}
        onChange={setMode}
        options={[
          { value: 'login', label: 'Sign in' },
          { value: 'register', label: 'Create account' },
        ]}
      />
      <form onSubmit={submit} className="space-y-3">
        {mode === 'register' && (
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
        )}
        <Field label="Email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <Field label="Password" hint={mode === 'register' ? 'At least 8 characters' : undefined}>
          <Input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </Field>
        {error && <p className="text-sm text-critical-ink">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
      {googleClientId && !isNative && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted">
            <div className="h-px flex-1 bg-line" /> or <div className="h-px flex-1 bg-line" />
          </div>
          <GoogleButton clientId={googleClientId} onSuccess={onSuccess} />
        </>
      )}
      <p className="text-xs text-muted">Your local data stays on this device and is uploaded to your account when you sign in.</p>
    </div>
  );
}
