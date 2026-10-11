/**
 * Pictures and PDFs attached to notes. Files live in IndexedDB on this device;
 * the note body references them with Markdown so they appear where they were
 * inserted: ![name](notefile:<id>) for pictures, [name](notefile:<id>) for PDFs.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { defaultUrlTransform } from 'react-markdown';
import { db, type NoteFile } from './db';
import { draw, loadImage } from './copilot/attachments';

export const NOTE_FILE_ACCEPT = 'image/*,application/pdf,.pdf';
export const NOTE_FILE_SCHEME = 'notefile:';
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Large photos are scaled to 2400 px so notes stay light; small, GIF and undecodable images are kept as they are. */
async function shrink(file: File): Promise<File> {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml' || file.size < 400 * 1024) return file;
  try {
    const img = await loadImage(file);
    const blob = await new Promise<Blob>((res, rej) => draw(img, 2400).toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.86));
    return blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

/** Markdown-safe link text. */
const label = (name: string) => name.replace(/[[\]\\]/g, '').trim() || 'file';

/** Save a file for a note; returns its id and the Markdown that shows it. Throws an Error with a user-facing message. */
export async function addNoteFile(noteId: string, input: File): Promise<{ id: string; markdown: string }> {
  const image = input.type.startsWith('image/');
  if (!image && !isPdf(input)) throw new Error(`"${input.name}" isn't a picture or PDF.`);
  if (input.size > (image ? MAX_IMAGE_BYTES : MAX_PDF_BYTES)) throw new Error(`"${input.name}" is too large (25 MB max).`);
  const file = image ? await shrink(input) : input;
  const rec: NoteFile = {
    id: uuid(),
    noteId,
    name: file.name,
    type: image ? file.type : 'application/pdf',
    size: file.size,
    blob: file,
    createdAt: new Date().toISOString(),
  };
  await db.noteFiles.put(rec);
  return { id: rec.id, markdown: image ? `![${label(rec.name)}](${NOTE_FILE_SCHEME}${rec.id})` : `[📄 ${label(rec.name)}](${NOTE_FILE_SCHEME}${rec.id})` };
}

export async function deleteNoteFileIds(ids: Iterable<string>): Promise<void> {
  await db.noteFiles.bulkDelete([...ids]);
}

/** The body without any reference to the file (the file itself is untouched). */
export function stripNoteFile(body: string, id: string): string {
  const ref = `(${NOTE_FILE_SCHEME}${id})`;
  const link = new RegExp(`!?\\[[^\\]]*\\]\\(${NOTE_FILE_SCHEME}${id}\\)`, 'g');
  return body
    .split('\n')
    .flatMap((line) => {
      if (!line.includes(ref)) return [line];
      const rest = line.replace(link, '').trimEnd();
      return rest.trim() ? [rest] : []; // drop lines that held only the file
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export async function deleteNoteFiles(noteId: string): Promise<void> {
  await db.noteFiles.where('noteId').equals(noteId).delete();
}

export function noteFileId(url: string | undefined | null): string | null {
  return url?.startsWith(NOTE_FILE_SCHEME) ? url.slice(NOTE_FILE_SCHEME.length) : null;
}

/** react-markdown drops unknown URL schemes; keep ours. */
export const noteUrlTransform = (url: string) => (url.startsWith(NOTE_FILE_SCHEME) ? url : defaultUrlTransform(url));

export function useNoteFiles(noteId: string): NoteFile[] | undefined {
  return useLiveQuery(() => db.noteFiles.where('noteId').equals(noteId).sortBy('createdAt'), [noteId]);
}

/** The stored file and a temporary URL for it. `file` is null when it isn't on this device. */
export function useNoteFile(id: string): { file: NoteFile | null | undefined; url: string | null } {
  const file = useLiveQuery(async () => (await db.noteFiles.get(id)) ?? null, [id]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return { file, url };
}

const FILE_LINK = /(!?)\[(?:📄\s*)?([^\]]*)\]\(notefile:[^)]+\)/g;

/** One line of plain text for the notes list, e.g. "📷 Photo · Key points of chapter 3". */
export function noteSnippet(body: string, max = 90): string {
  return body
    .replace(FILE_LINK, (_, img: string, name: string) => (img ? '📷 Photo ' : `📄 ${name || 'PDF'} `))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '📷 Photo ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/[*_~`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** The note as text for another app: file links become "[Photo: name]" / "[PDF: name]". */
export function noteShareText(note: { title: string; body: string }): string {
  const body = note.body.replace(FILE_LINK, (_, img: string, name: string) => `[${img ? 'Photo' : 'PDF'}: ${name.trim() || 'file'}]`).trim();
  return body ? `*${note.title}*\n\n${body}` : `*${note.title}*`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Share notes (text plus their pictures and PDFs) through the phone's share
 * sheet. Falls back to text only, then to copying the text.
 * Returns 'shared' | 'copied' | 'cancelled'.
 */
export async function shareNotes(notes: Array<{ id: string; title: string; body: string }>): Promise<'shared' | 'copied' | 'cancelled'> {
  const text = notes.map(noteShareText).join('\n\n— — —\n\n');
  const title = notes.length === 1 ? notes[0]!.title : `${notes.length} notes`;
  const files = (await db.noteFiles.where('noteId').anyOf(notes.map((n) => n.id)).toArray()).slice(0, 10);
  const { isNative } = await import('./platform');
  try {
    if (isNative) {
      const [{ Share }, { Filesystem, Directory }] = await Promise.all([import('@capacitor/share'), import('@capacitor/filesystem')]);
      const uris: string[] = [];
      for (const f of files) {
        const path = `share/${f.id}-${f.name.replace(/[^\w.-]+/g, '_')}`;
        const res = await Filesystem.writeFile({ path, data: await blobToBase64(f.blob), directory: Directory.Cache, recursive: true });
        uris.push(res.uri);
      }
      await Share.share({ title, text, dialogTitle: 'Share note', ...(uris.length ? { files: uris } : {}) });
      return 'shared';
    }
    if (navigator.share) {
      const asFiles = files.map((f) => new File([f.blob], f.name, { type: f.type }));
      const withFiles = asFiles.length && navigator.canShare?.({ files: asFiles }) ? { files: asFiles } : {};
      await navigator.share({ title, text, ...withFiles });
      return 'shared';
    }
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if ((err as Error)?.name === 'AbortError' || /cancel/i.test(msg)) return 'cancelled';
    // Fall through to copying.
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
