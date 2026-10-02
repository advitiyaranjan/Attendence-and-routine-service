import { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useCopilot } from '../lib/copilot/store';

const PROMPTS: Record<string, string> = {
  'plan-today': 'What do I need to do today? Then organise my evening.',
};

/** Old /assistant links open the one AI Pilot panel over Home. */
export default function Assistant() {
  const [params] = useSearchParams();
  const prompt = params.get('prompt');
  const setOpen = useCopilot((s) => s.setOpen);
  useEffect(() => setOpen(true, prompt ? (PROMPTS[prompt] ?? prompt) : null), [prompt, setOpen]);
  return <Navigate to="/" replace />;
}
