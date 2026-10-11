/** Chat helpers: copy a message, and pictures AI Pilot drew (inline, full-screen viewer, download). */
import { useEffect, useState } from 'react';
import { Check, Copy, Download, ImageOff, RotateCcw, X } from 'lucide-react';
import { useCopilot, type CopilotMessage } from '../../lib/copilot/store';
import { toast } from '../../lib/store';
import { cn } from '../ui';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      aria-label={copied ? 'Copied' : 'Copy message'}
      title={copied ? 'Copied' : 'Copy'}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } else toast("Couldn't copy", 'error');
      }}
      className={cn('inline-flex size-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink', className)}
    >
      {copied ? <Check className="size-3.5 text-good-ink" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Full-screen view of one picture, with download. Escape or tapping outside closes it. */
export function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal aria-label={alt || 'Image'} className="fixed inset-0 z-[100] flex flex-col bg-black/90 p-3 sm:p-6" onClick={onClose}>
      <div className="flex justify-end gap-2">
        <a
          href={src}
          download={`ai-pilot-${Date.now()}.jpg`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-sm font-medium text-white hover:bg-white/25"
        >
          <Download className="size-4" /> Download
        </a>
        <button type="button" aria-label="Close" onClick={onClose} className="inline-flex size-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25">
          <X className="size-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center py-3">
        <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-xl object-contain shadow-pop" />
      </div>
      {alt && <p className="text-center text-sm text-white/80">{alt}</p>}
    </div>
  );
}

/** A picture in a message: tap to open full-screen. Used for drawn images and markdown images. */
export function ChatImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group relative block overflow-hidden rounded-2xl border border-line bg-surface-2" aria-label={`Open image${alt ? `: ${alt}` : ''}`}>
        <img src={src} alt={alt} loading="lazy" className="max-h-[420px] w-full object-contain transition-transform duration-300 group-hover:scale-[1.01]" />
      </button>
      {open && <ImageViewer src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

export function MessageImages({ m }: { m: CopilotMessage }) {
  const drawImage = useCopilot((s) => s.drawImage);
  if (!m.images?.length) return null;
  return (
    <div className="space-y-2">
      {m.images.map((img, i) => (
        <figure key={i} className="space-y-1.5">
          {img.status === 'ready' && img.src ? (
            <ChatImage src={img.src} alt={img.caption ?? ''} />
          ) : img.status === 'loading' ? (
            <div className="flex aspect-[4/3] w-full max-w-md animate-pulse flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-gradient-to-br from-tint-gold via-surface-2 to-tint-lilac text-sm text-ink-2">
              <span className="size-6 animate-spin rounded-full border-2 border-gold border-t-transparent" aria-hidden />
              Drawing your picture…
            </div>
          ) : (
            <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3 text-sm">
              <ImageOff className="size-5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 text-ink-2">{img.error ?? "Couldn't draw the picture."}</span>
              <button type="button" onClick={() => void drawImage(m.id, i)} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-medium text-accent hover:bg-accent-soft">
                <RotateCcw className="size-3.5" /> Retry
              </button>
            </div>
          )}
          {img.caption && img.status === 'ready' && <figcaption className="text-xs text-muted">{img.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
