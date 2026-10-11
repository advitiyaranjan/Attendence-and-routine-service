/** Chat helpers: copy a message, and pictures AI Pilot drew (inline, full-screen viewer, download). */
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, ImageOff, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useCopilot, type CopilotMessage } from '../../lib/copilot/store';
import { toast } from '../../lib/store';
import { cn, useBackToClose } from '../ui';

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

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

interface View {
  scale: number;
  x: number;
  y: number;
}

/**
 * Pinch, wheel, double-tap and drag zoom for one image. The page itself can't
 * be pinch-zoomed in the app, so the viewer does it. Offsets are in screen
 * pixels from the centred position.
 */
function useZoom() {
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  /** Animate button and double-tap zooms; follow fingers and the wheel directly. */
  const [smooth, setSmooth] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; mid: { x: number; y: number }; view: View } | null>(null);
  const lastTap = useRef(0);
  const moved = useRef(false);

  /** Zoom to `scale` keeping the screen point (cx, cy) fixed under the finger/cursor. */
  const zoomAt = useCallback((scale: number, cx: number, cy: number, from: View = viewRef.current) => {
    const el = stage.current;
    const next = clampZoom(scale);
    if (!el || next === 1) return setView({ scale: 1, x: 0, y: 0 });
    const r = el.getBoundingClientRect();
    const px = cx - (r.left + r.width / 2);
    const py = cy - (r.top + r.height / 2);
    const k = next / from.scale;
    setView({ scale: next, x: px - (px - from.x) * k, y: py - (py - from.y) * k });
  }, []);

  // Wheel needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setSmooth(false);
      zoomAt(viewRef.current.scale * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved.current = false;
      const pts = [...pointers.current.values()];
      if (pts.length === 2) {
        const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
        gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: viewRef.current.scale, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: viewRef.current };
      } else {
        gesture.current = { dist: 0, scale: viewRef.current.scale, mid: { x: e.clientX, y: e.clientY }, view: viewRef.current };
      }
    },
    onPointerMove: (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId) || !gesture.current) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.current.values()];
      const g = gesture.current;
      setSmooth(false);
      if (pts.length >= 2) {
        const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        moved.current = true;
        const el = stage.current!;
        const r = el.getBoundingClientRect();
        const next = clampZoom((g.scale * dist) / (g.dist || dist));
        const px = g.mid.x - (r.left + r.width / 2);
        const py = g.mid.y - (r.top + r.height / 2);
        const k = next / g.view.scale;
        setView(next === 1 ? { scale: 1, x: 0, y: 0 } : { scale: next, x: px - (px - g.view.x) * k + (mid.x - g.mid.x), y: py - (py - g.view.y) * k + (mid.y - g.mid.y) });
      } else if (g.view.scale > 1) {
        const dx = e.clientX - g.mid.x;
        const dy = e.clientY - g.mid.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
        setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
      } else if (Math.abs(e.clientX - g.mid.x) + Math.abs(e.clientY - g.mid.y) > 6) {
        moved.current = true;
      }
    },
    onPointerUp: (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      const rest = [...pointers.current.values()];
      // One finger left after a pinch: continue as a pan from here.
      gesture.current = rest.length === 1 ? { dist: 0, scale: viewRef.current.scale, mid: rest[0]!, view: viewRef.current } : null;
      if (rest.length || moved.current) return;
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        setSmooth(true);
        zoomAt(viewRef.current.scale > 1 ? 1 : 2.5, e.clientX, e.clientY);
      } else lastTap.current = now;
    },
    onPointerCancel: (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      gesture.current = null;
    },
  };

  const step = (factor: number) => {
    const r = stage.current?.getBoundingClientRect();
    setSmooth(true);
    if (r) zoomAt(viewRef.current.scale * factor, r.left + r.width / 2, r.top + r.height / 2);
  };
  const reset = () => {
    setSmooth(true);
    setView({ scale: 1, x: 0, y: 0 });
  };
  return { view, smooth, stage, handlers, zoomIn: () => step(1.5), zoomOut: () => step(1 / 1.5), reset };
}

const toolbarBtn = 'inline-flex size-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 disabled:opacity-40';

/**
 * Full-screen view of one picture: pinch, scroll or double-tap to zoom, drag to
 * move, download. Escape, Back or the close button closes it.
 */
export function ImageViewer({ src, alt, onClose, fileName }: { src: string; alt: string; onClose: () => void; fileName?: string }) {
  const { view, smooth, stage, handlers, zoomIn, zoomOut, reset } = useZoom();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-') zoomOut();
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoomIn, zoomOut, reset]);
  useBackToClose(true, onClose);
  const zoomed = view.scale > 1;
  return createPortal(
    <div role="dialog" aria-modal aria-label={alt || 'Image'} className="fixed inset-0 z-[100] flex select-none flex-col bg-black/90 p-3 sm:p-6" style={{ paddingTop: 'max(0.75rem, var(--sat))', paddingBottom: 'max(0.75rem, var(--sab))' }}>
      <div className="relative z-10 flex items-center justify-end gap-2">
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={!zoomed} onClick={zoomOut} className={toolbarBtn}>
          <ZoomOut className="size-[18px]" />
        </button>
        <button type="button" aria-label="Reset zoom" title="Reset zoom" onClick={reset} className="inline-flex h-9 min-w-14 items-center justify-center rounded-full bg-white/15 px-2.5 text-sm font-medium tabular-nums text-white hover:bg-white/25">
          {Math.round(view.scale * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={view.scale >= MAX_ZOOM} onClick={zoomIn} className={toolbarBtn}>
          <ZoomIn className="size-[18px]" />
        </button>
        <span className="flex-1" />
        <a href={src} download={fileName ?? `ai-pilot-${Date.now()}.jpg`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3.5 text-sm font-medium text-white hover:bg-white/25">
          <Download className="size-4" /> <span className="hidden sm:inline">Download</span>
        </a>
        <button type="button" aria-label="Close" onClick={onClose} className={toolbarBtn}>
          <X className="size-5" />
        </button>
      </div>
      <div
        ref={stage}
        {...handlers}
        className={cn('relative my-3 min-h-0 flex-1 touch-none overflow-hidden', zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="pointer-events-none absolute inset-0 m-auto max-h-full max-w-full rounded-xl object-contain shadow-pop will-change-transform"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: smooth ? 'transform 0.18s ease-out' : undefined }}
        />
      </div>
      <p className="relative z-10 text-center text-xs text-white/60">{alt ? <span className="mb-0.5 block text-sm text-white/80">{alt}</span> : null}Pinch, scroll or double-tap to zoom</p>
    </div>,
    document.body,
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
