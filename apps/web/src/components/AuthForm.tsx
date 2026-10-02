import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { login, loginWithGoogle, register } from '../lib/auth';
import { isNative } from '../lib/platform';
import { toast, useApp } from '../lib/store';
import { Button, Field, Input } from './ui';

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

/** Google Identity Services button ("Continue with Google"), sized to its container. */
export function GoogleButton({ clientId, onSuccess }: { clientId: string; onSuccess: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const render = () => {
      const el = ref.current;
      if (cancelled || !window.google || !el) return;
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
      const dark = document.documentElement.classList.contains('dark');
      window.google.accounts.id.renderButton(el, {
        theme: dark ? 'filled_black' : 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        logo_alignment: 'center',
        width: Math.min(400, Math.max(200, el.clientWidth)),
      });
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
  return <div ref={ref} className="flex min-h-11 w-full justify-center" />;
}

/**
 * Sign in / sign up with Google or email + password. Nothing else is asked here;
 * academic details are collected later, only when needed.
 */
export type AuthMode = 'login' | 'register';

export function AuthForm({ onSuccess, mode: controlled, onModeChange }: { onSuccess: () => void; mode?: AuthMode; onModeChange?: (m: AuthMode) => void }) {
  const [own, setOwn] = useState<AuthMode>('login');
  const mode = controlled ?? own;
  const setMode = (m: AuthMode) => (onModeChange ? onModeChange(m) : setOwn(m));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
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
      else await register(email, password);
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!online) return <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">Signing in needs an internet connection.</p>;

  return (
    <div className="space-y-4">
      {googleClientId && !isNative && (
        <>
          <GoogleButton clientId={googleClientId} onSuccess={onSuccess} />
          <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-muted">
            <div className="h-px flex-1 bg-line" /> or <div className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="Enter your email" className="h-11" />
        </Field>
        <Field label="Password" hint={mode === 'register' ? 'At least 8 characters' : undefined}>
          <div className="relative">
            <Input
              type={show ? 'text' : 'password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'login' ? 'Enter your password' : 'Create a password'}
              className="h-11 pr-11"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-ink"
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        {error && (
          <p className="rounded-xl bg-critical/10 px-3 py-2 text-sm text-critical-ink" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
      <p className="text-center text-sm text-ink-2">
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button
          type="button"
          className="font-semibold text-accent hover:underline"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? 'Sign up' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}
