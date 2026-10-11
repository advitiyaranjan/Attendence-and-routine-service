/** Pictures and PDFs inside notes: inline previews, the attachment strip, and a full-screen PDF reader. */
import { useEffect, useRef, useState, type ReactNode, type TouchList } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, ImageOff, Loader2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { NoteFile } from '../lib/db';
import { useNoteFile } from '../lib/note-files';
import { formatSize } from '../lib/copilot/attachments';
import { isNative } from '../lib/platform';
import { ImageViewer } from './copilot/ChatExtras';
import { cn, useBackToClose } from './ui';

function Missing({ what }: { what: string }) {
  return (
    <span className="my-1 inline-flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted">
      <ImageOff className="size-4" /> {what} was added on another device
    </span>
  );
}

/** A picture in a note: tap to open it full-screen with zoom. */
export function NoteFileImage({ id, alt }: { id: string; alt: string }) {
  const { file, url } = useNoteFile(id);
  const [open, setOpen] = useState(false);
  if (file === null) return <Missing what="This picture" />;
  if (!url) return <span className="my-1 block h-40 w-full max-w-md animate-pulse rounded-xl bg-surface-2" />;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="my-1 block max-w-full overflow-hidden rounded-xl border border-line bg-surface-2" aria-label={`Open picture: ${alt || file!.name}`}>
        <img src={url} alt={alt} className="max-h-[480px] max-w-full object-contain" />
      </button>
      {open && <ImageViewer src={url} alt={alt} fileName={file!.name} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A PDF (or other file) link in a note: opens the in-app reader. */
export function NoteFileLink({ id }: { id: string; children?: ReactNode }) {
  const { file, url } = useNoteFile(id);
  const [open, setOpen] = useState(false);
  if (file === null) return <Missing what="This PDF" />;
  if (!file || !url) return null;
  return (
    <>
      <FileChip file={file} onOpen={() => setOpen(true)} />
      {open && (file.type.startsWith('image/') ? <ImageViewer src={url} alt={file.name} fileName={file.name} onClose={() => setOpen(false)} /> : <PdfViewer file={file} url={url} onClose={() => setOpen(false)} />)}
    </>
  );
}

function FileChip({ file, onOpen, onRemove, url }: { file: NoteFile; onOpen: () => void; onRemove?: () => void; url?: string | null }) {
  return (
    <span className="my-1 inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-surface p-1.5 pr-2 align-middle text-xs not-italic">
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2 text-left" title={`Open ${file.name}`}>
        {file.type.startsWith('image/') && url ? (
          <img src={url} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tint-rose text-rose-ink">
            <FileText className="size-4" />
          </span>
        )}
        <span className="min-w-0">
          <span className="block max-w-48 truncate font-medium text-ink">{file.name}</span>
          <span className="text-muted">
            {file.type === 'application/pdf' ? 'PDF' : 'Picture'} · {formatSize(file.size)}
          </span>
        </span>
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-critical-ink" aria-label={`Remove ${file.name}`} title="Remove from note">
          <X className="size-3.5" />
        </button>
      )}
    </span>
  );
}

/** Every file attached to the note, shown under the editor. */
export function NoteFileStrip({ files, onRemove }: { files: NoteFile[]; onRemove: (f: NoteFile) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Attachments">
      {files.map((f) => (
        <StripItem key={f.id} file={f} onRemove={() => onRemove(f)} />
      ))}
    </div>
  );
}

function StripItem({ file, onRemove }: { file: NoteFile; onRemove: () => void }) {
  const { url } = useNoteFile(file.id);
  const [open, setOpen] = useState(false);
  return (
    <>
      <FileChip file={file} url={url} onOpen={() => setOpen(true)} onRemove={onRemove} />
      {open && url && (file.type.startsWith('image/') ? <ImageViewer src={url} alt={file.name} fileName={file.name} onClose={() => setOpen(false)} /> : <PdfViewer file={file} url={url} onClose={() => setOpen(false)} />)}
    </>
  );
}

// ---------------------------------------------------------------------------
// PDF reader (pdf.js, loaded on first use; the Android WebView has no PDF viewer)

/** Loads the PDF; `cancelled` is checked once pdf.js is ready, and the returned closer frees the worker. */
async function openPdf(blob: Blob, cancelled: () => boolean): Promise<{ doc: PDFDocumentProxy; close: () => void } | null> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  if (cancelled()) return null;
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const close = () => void task.destroy();
  if (cancelled()) {
    close();
    return null;
  }
  return { doc: await task.promise, close };
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

/** One page, drawn when it scrolls near the screen and redrawn sharp after zooming. */
function PdfPage({ doc, n, width }: { doc: PDFDocumentProxy; n: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(1.414);
  const [visible, setVisible] = useState(n <= 2);

  useEffect(() => {
    let live = true;
    void doc.getPage(n).then((p) => {
      const v = p.getViewport({ scale: 1 });
      if (live) setRatio(v.height / v.width);
    });
    return () => {
      live = false;
    };
  }, [doc, n]);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !width) return;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    let live = true;
    void doc.getPage(n).then((page) => {
      const c = canvas.current;
      if (!live || !c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr });
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      task = page.render({ canvas: c, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, n, width, visible]);

  return (
    <div ref={box} className="mx-auto bg-white shadow-card" style={{ width, height: width * ratio }}>
      <canvas ref={canvas} className="block size-full" aria-label={`Page ${n}`} />
    </div>
  );
}

export function PdfViewer({ file, url, onClose }: { file: NoteFile; url: string; onClose: () => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pinch, setPinch] = useState(1);
  const [fit, setFit] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const touch = useRef<{ dist: number } | null>(null);
  useBackToClose(true, onClose);

  useEffect(() => {
    let done = false;
    let close: (() => void) | null = null;
    openPdf(file.blob, () => done)
      .then((res) => {
        if (!res) return;
        close = res.close;
        if (done) return res.close();
        setDoc(res.doc);
      })
      .catch(() => !done && setError("Couldn't open this PDF."));
    return () => {
      done = true;
      close?.();
    };
  }, [file]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setFit(Math.min(el.clientWidth - 24, 900));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Ctrl/⌘ + wheel (and trackpad pinch) zooms the pages, not the app.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * Math.exp(-e.deltaY * 0.004))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const step = (k: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * k)));
  const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
  const btn = 'inline-flex size-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40';

  return createPortal(
    <div role="dialog" aria-modal aria-label={file.name} className="fixed inset-0 z-[100] flex flex-col bg-page" style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}>
      <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
        <FileText className="ml-1 size-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
          {file.name}
          {doc && <span className="ml-1.5 font-normal text-muted">· {doc.numPages} {doc.numPages === 1 ? 'page' : 'pages'}</span>}
        </span>
        <button type="button" className={btn} aria-label="Zoom out" title="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => step(1 / 1.25)}>
          <ZoomOut className="size-[18px]" />
        </button>
        <button type="button" className="h-9 min-w-12 rounded-full px-1.5 text-xs font-medium tabular-nums text-ink-2 hover:bg-surface-2" title="Fit width" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className={btn} aria-label="Zoom in" title="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => step(1.25)}>
          <ZoomIn className="size-[18px]" />
        </button>
        {!isNative && (
          <a href={url} download={file.name} className={btn} aria-label="Download" title="Download">
            <Download className="size-[18px]" />
          </a>
        )}
        <button type="button" className={btn} aria-label="Close" title="Close" onClick={onClose}>
          <X className="size-5" />
        </button>
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto overscroll-contain bg-surface-2 py-3"
        onTouchStart={(e) => {
          if (e.touches.length === 2) touch.current = { dist: dist(e.touches) };
        }}
        onTouchMove={(e) => {
          if (e.touches.length !== 2 || !touch.current) return;
          setPinch(Math.min(MAX_ZOOM / zoom, Math.max(MIN_ZOOM / zoom, dist(e.touches) / touch.current.dist)));
        }}
        onTouchEnd={() => {
          if (!touch.current) return;
          touch.current = null;
          setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * pinch)));
          setPinch(1);
        }}
      >
        {error ? (
          <p className="p-6 text-center text-sm text-ink-2">{error}</p>
        ) : !doc || !fit ? (
          <p className="flex items-center justify-center gap-2 p-6 text-sm text-ink-2">
            <Loader2 className="size-4 animate-spin" /> Opening PDF…
          </p>
        ) : (
          <div className={cn('flex w-max min-w-full flex-col gap-3 px-3', pinch !== 1 && 'origin-top')} style={pinch !== 1 ? { transform: `scale(${pinch})` } : undefined}>
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} n={i + 1} width={Math.round(fit * zoom)} />
            ))}
          </div>
        )}
      </div>
      <p className="border-t border-line bg-surface px-3 py-1 text-center text-xs text-muted">Pinch or use + / − to zoom</p>
    </div>,
    document.body,
  );
}
