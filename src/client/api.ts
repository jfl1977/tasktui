import type { Attachment, Doc, Task } from '../shared/types';

export class ConflictError extends Error {
  constructor(public doc: Doc) {
    super('Changed in another window');
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (res.status === 409) throw new ConflictError(body.doc);
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  load: () => fetch('/api/data').then((r) => json<{ doc: Doc; archive: Task[]; dataDir: string }>(r)),
  save: (doc: Doc) =>
    fetch('/api/data', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) }).then((r) =>
      json<{ doc: Doc }>(r),
    ),
  archive: (rev: number) =>
    fetch('/api/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev }) }).then(
      (r) => json<{ doc: Doc; archive: Task[]; moved: number }>(r),
    ),
  upload: (blob: Blob, name: string) =>
    fetch(`/api/attachments?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob }).then((r) => json<Attachment>(r)),
  open: (file: string) =>
    fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file }) }).then((r) =>
      json<{ ok: true }>(r),
    ),
};

export const attachmentUrl = (file: string) => `/attachments/${encodeURIComponent(file)}`;

export const isImage = (name: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);

/** Name for a pasted screenshot, which the clipboard gives as "image.png". */
export function pastedName(f: File): string {
  if (f.name && f.name !== 'image.png') return f.name;
  const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return `screenshot.${ext}`;
}

/** Files from a paste or drop event (screenshots, files copied in Explorer, dragged files). */
export function filesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const files = [...dt.files];
  if (files.length) return files;
  return [...dt.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
}
