/**
 * Files attached to an AI Pilot message (photos, PDFs, Word, Excel, text).
 * Photos are downscaled in the browser so uploads stay small and fast and
 * within serverless request limits (Vercel: 4.5 MB per request).
 */

export const MAX_FILES = 4;
/** Total upload budget per message, below the hosting limit with room for the JSON payload. */
export const MAX_TOTAL_BYTES = 3.8 * 1024 * 1024;
export const ACCEPT = 'image/*,application/pdf,.pdf,.docx,.xlsx,.csv,.txt,.md,text/plain,text/csv,text/markdown';

export interface AttachmentMeta {
  name: string;
  type: string;
  size: number;
  /** Small preview for images (data URL), kept in chat history. */
  thumb?: string;
}

export interface PreparedAttachment {
  file: File;
  meta: AttachmentMeta;
}

const DOC_EXT = /\.(pdf|docx|xlsx|csv|txt|md|json|tsv)$/i;

export function isSupported(file: File): boolean {
  return file.type.startsWith('image/') || file.type === 'application/pdf' || DOC_EXT.test(file.name);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // transparent PNGs → white, so text stays readable as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Validate and shrink a file for upload. Throws an Error with a user-facing message. */
export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  if (!isSupported(file)) throw new Error(`"${file.name}" isn't supported. Attach photos, PDFs, Word, Excel or text files.`);
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return { file, meta: { name: file.name, type: file.type || 'application/octet-stream', size: file.size } };
  }
  try {
    const img = await loadImage(file);
    const blob = await new Promise<Blob>((res, rej) => draw(img, 1600).toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.82));
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    const thumb = draw(img, 96).toDataURL('image/jpeg', 0.7);
    const out = new File([blob], name, { type: 'image/jpeg' });
    return { file: out.size < file.size ? out : file, meta: { name, type: 'image/jpeg', size: Math.min(out.size, file.size), thumb } };
  } catch {
    // e.g. HEIC the browser can't decode: send as-is (the server/Gemini can read it).
    return { file, meta: { name: file.name, type: file.type, size: file.size } };
  }
}

export function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
