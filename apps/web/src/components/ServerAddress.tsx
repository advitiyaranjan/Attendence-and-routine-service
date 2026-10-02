import { useState } from 'react';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { apiBase, setApiBase } from '../lib/platform';
import { useApp } from '../lib/store';
import { Button, Field, Input } from './ui';

/**
 * Android app: where the Student OS server runs (for sync, sign-in and AI).
 * The app works fully offline without one.
 */
export function ServerAddress({ onSaved }: { onSaved?: () => void }) {
  const [value, setValue] = useState(apiBase());
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function test() {
    const base = setApiBase(value);
    setValue(base);
    setBusy(true);
    setState(null);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${base}/api/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(String(res.status));
      setState({ ok: true, text: 'Connected to the server.' });
      // Re-check AI availability against the new server.
      fetch(`${base}/api/ai/status`)
        .then((r) => r.json())
        .then((s) => useApp.setState({ aiAvailable: !!s.available }))
        .catch(() => undefined);
      onSaved?.();
    } catch {
      setState({ ok: false, text: "Can't reach that address. Is the server running, and is the phone on the same network?" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Field label="Server address" hint="e.g. http://192.168.1.10:4000 (your computer's Wi-Fi IP) or https://your-server.com. Only needed for sync, sign-in and AI.">
        <div className="flex gap-2">
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="http://192.168.1.10:4000" inputMode="url" autoCapitalize="off" autoCorrect="off" />
          <Button variant="secondary" loading={busy} disabled={!value.trim()} onClick={test}>
            Save & test
          </Button>
        </div>
      </Field>
      {state && (
        <p className={`flex items-center gap-1.5 text-xs ${state.ok ? 'text-good-ink' : 'text-critical-ink'}`}>
          {state.ok ? <CheckCircle2 className="size-3.5" /> : <TriangleAlert className="size-3.5" />} {state.text}
        </p>
      )}
    </div>
  );
}
