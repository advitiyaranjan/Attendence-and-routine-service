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

/** Save a file for a note and return the Markdown that shows it. Throws an Error with a user-facing message. */
export async function addNoteFile(noteId: string, input: File): Promise<string> {
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
  return image ? `![${label(rec.name)}](${NOTE_FILE_SCHEME}${rec.id})` : `[📄 ${label(rec.name)}](${NOTE_FILE_SCHEME}${rec.id})`;
}

/** Remove a file and every reference to it in the body. */
export async function removeNoteFile(id: string, body: string): Promise<string> {
  await db.noteFiles.delete(id);
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
