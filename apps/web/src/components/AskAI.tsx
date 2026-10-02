import { useState } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { useCopilot } from '../lib/copilot/store';
import { cn } from './ui';

/**
 * Inline entry point to AI Pilot on any page ("Ask AI about my attendance…").
 * Opens the AI panel and sends the question; changes still need confirmation there.
 */
export function AskAI({ placeholder, prompts = [], className }: { placeholder: string; prompts?: string[]; className?: string }) {
  const [text, setText] = useState('');
  const { send, setOpen } = useCopilot();
  const ask = (t: string) => {
    const q = t.trim();
    if (!q) return;
    setOpen(true);
    void send(q);
    setText('');
  };
  return (
    <div className={cn('space-y-2', className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
        className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-1.5 pl-3.5 shadow-card transition-shadow focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15"
      >
        <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted focus:outline-none sm:text-sm"
          enterKeyHint="send"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink transition-opacity disabled:opacity-40"
          aria-label="Ask AI"
        >
          <ArrowUp className="size-4" />
        </button>
      </form>
      {prompts.length > 0 && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {prompts.map((p) => (
            <button
              key={p}
              onClick={() => ask(p)}
              className="shrink-0 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-accent/40 hover:text-ink"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
