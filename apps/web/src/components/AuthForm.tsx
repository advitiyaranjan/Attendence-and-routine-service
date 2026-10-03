import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, MailCheck } from 'lucide-react';
import { errorMessage } from '../lib/api';
import { APP_LINK_GOOGLE, forgotPassword, login, loginWithGoogle, register, resendCode, resetPassword, openGoogleInBrowser, startNativeGoogleSignIn, verifyCode, type OtpChallenge } from '../lib/auth';
import { isNative } from '../lib/platform';
import { toast, useApp } from '../lib/store';
import { Button, Field, Input } from './ui';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(opts: { client_id: string; nonce?: string; callback: (r: { credential: string }) => void }): void;
          renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
        };
      };
    };
  }
}

/** Google Identity Services button ("Continue with Google"), sized to its container. */
export function GoogleButton({ clientId, onSuccess, nonce, onCredential }: { clientId: string; onSuccess: () => void; nonce?: string; onCredential?: (credential: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const render = () => {
      const el = ref.current;
      if (cancelled || !window.google || !el) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        nonce,
        callback: async ({ credential }) => {
          if (onCredential) return onCredential(credential);
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
  }, [clientId, onSuccess, nonce, onCredential]);
  return <div ref={ref} className="flex min-h-11 w-full justify-center" />;
}

/** Android app: Google blocks its sign-in inside app WebViews, so it runs in a Chrome tab and returns. */
function NativeGoogleButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await startNativeGoogleSignIn();
        } catch (err) {
          toast(errorMessage(err), 'error');
        } finally {
          setTimeout(() => setBusy(false), 1500);
        }
      }}
      className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface text-sm font-medium text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
    >
      <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z" />
      </svg>
      {busy ? 'Opening Google…' : 'Continue with Google'}
    </button>
  );
}

/** Google sign-in problem in the app, kept on screen (with the exact error) until dismissed. */
function GoogleNotice() {
  const notice = useApp((s) => s.googleNotice);
  if (!notice) return null;
  return (
    <div role="alert" className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink-2">
      <p className="select-text break-words">{notice}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => void openGoogleInBrowser()}>
          Use browser
        </Button>
        <Button size="sm" variant="ghost" onClick={() => useApp.setState({ googleNotice: null })}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/**
 * Web page opened by the Android app in a Chrome tab (/app-google?nonce=…): signs in with
 * Google and hands the ID token back to the app through its link scheme. The nonce ties the
 * token to the app that asked, so an intercepted link is useless on its own.
 */
export function AppGoogleBridge() {
  const params = new URLSearchParams(window.location.search);
  const nonce = params.get('nonce') ?? '';
  const [clientId, setClientId] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'omit' })
      .then((r) => r.json())
      .then((r: { googleClientId: string | null }) => (r.googleClientId ? setClientId(r.googleClientId) : setError('Google sign-in is not set up on this server.')))
      .catch(() => setError("Can't reach the server. Check your connection and try again."));
  }, []);
  const onCredential = (credential: string) => {
    const url = `${APP_LINK_GOOGLE}?credential=${encodeURIComponent(credential)}`;
    setBack(url);
    window.location.href = url;
  };
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <main className="w-full max-w-sm space-y-5 text-center">
        <h1 className="text-xl font-semibold">Sign in to Student OS</h1>
        {!/^[0-9a-f]{64}$/.test(nonce) ? (
          <p className="text-sm text-ink-2">Open this page from the Student OS app.</p>
        ) : back ? (
          <a href={back} className="flex h-11 w-full items-center justify-center rounded-xl bg-accent text-sm font-medium text-accent-ink">
            Return to the app
          </a>
        ) : error ? (
          <p className="text-sm text-critical-ink">{error}</p>
        ) : clientId ? (
          <GoogleButton clientId={clientId} nonce={nonce} onSuccess={() => undefined} onCredential={onCredential} />
        ) : (
          <p className="text-sm text-ink-2">Loading…</p>
        )}
      </main>
    </div>
  );
}

/** 6-digit code entry with resend. Shared by sign-in, sign-up, password reset and email change. */
export function OtpStep({
  otp,
  onVerify,
  onBack,
  submitLabel = 'Verify',
  children,
}: {
  otp: OtpChallenge;
  onVerify: (code: string) => Promise<void>;
  onBack: () => void;
  submitLabel?: string;
  children?: React.ReactNode;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(60);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onVerify(code);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <MailCheck className="size-5" />
        </span>
        <p className="text-sm text-ink-2">
          We sent a 6-digit code to <strong className="break-all text-ink">{otp.email}</strong>. It expires in 10 minutes.
          {otp.purpose === 'reset' && ' If an account uses this email, the code is on its way.'}
        </p>
      </div>
      <Field label="Code">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••••"
          autoFocus
          required
          pattern="\d{6}"
          className="h-12 text-center font-semibold tracking-[0.5em] tabular"
          aria-label="6-digit code"
        />
      </Field>
      {children}
      {error && (
        <p className="rounded-xl bg-critical/10 px-3 py-2 text-sm text-critical-ink" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" loading={busy} disabled={code.length !== 6} className="w-full">
        {submitLabel}
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" /> Back
        </button>
        <button
          type="button"
          disabled={cooldown > 0}
          className="font-medium text-accent hover:underline disabled:text-muted disabled:no-underline"
          onClick={async () => {
            setError(null);
            try {
              await resendCode(otp);
              setCooldown(60);
              toast('New code sent', 'success');
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </button>
      </div>
    </form>
  );
}

/**
 * Sign in / sign up with Google or email + password, confirmed with an emailed
 * code. Also handles "Forgot password". Academic details are collected later.
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
  const [otp, setOtp] = useState<OtpChallenge | null>(null);
  const [forgot, setForgot] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const googleClientId = useApp((s) => s.googleClientId);
  const online = useApp((s) => s.online);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (forgot) setOtp(await forgotPassword(email));
      else setOtp(mode === 'login' ? await login(email, password) : await register(email, password));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!online) return <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">Signing in needs an internet connection.</p>;

  if (otp) {
    const reset = otp.purpose === 'reset';
    return (
      <OtpStep
        otp={otp}
        submitLabel={reset ? 'Set new password' : mode === 'login' ? 'Verify and sign in' : 'Verify and create account'}
        onBack={() => setOtp(null)}
        onVerify={async (code) => {
          if (reset) await resetPassword(otp, code, newPassword);
          else await verifyCode(otp, code);
          if (reset) toast('Password changed. You are signed in.', 'success');
          onSuccess();
        }}
      >
        {reset && (
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="Create a new password" className="h-11" />
          </Field>
        )}
      </OtpStep>
    );
  }

  return (
    <div className="space-y-4">
      {googleClientId && !forgot && (
        <>
          {isNative ? <NativeGoogleButton /> : <GoogleButton clientId={googleClientId} onSuccess={onSuccess} />}
          {isNative && <GoogleNotice />}
          <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-muted">
            <div className="h-px flex-1 bg-line" /> or <div className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      {forgot && <p className="text-sm text-ink-2">Enter your account email. We'll send a code to set a new password.</p>}
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="Enter your email" className="h-11" />
        </Field>
        {!forgot && (
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
        )}
        {mode === 'login' && !forgot && (
          <div className="-mt-1 text-right">
            <button
              type="button"
              className="text-sm font-medium text-accent hover:underline"
              onClick={() => {
                setForgot(true);
                setError(null);
              }}
            >
              Forgot password?
            </button>
          </div>
        )}
        {error && (
          <p className="rounded-xl bg-critical/10 px-3 py-2 text-sm text-critical-ink" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          {forgot ? 'Send reset code' : mode === 'login' ? 'Continue' : 'Create account'}
        </Button>
      </form>
      <p className="text-center text-sm text-ink-2">
        {forgot ? (
          <button
            type="button"
            className="font-semibold text-accent hover:underline"
            onClick={() => {
              setForgot(false);
              setError(null);
            }}
          >
            Back to sign in
          </button>
        ) : (
          <>
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
          </>
        )}
      </p>
    </div>
  );
}
