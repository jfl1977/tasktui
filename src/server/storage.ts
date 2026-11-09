import { promises as fs, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { toISODate, toISODateTime } from '../shared/dates';
import { archiveCandidates } from '../shared/logic';
import type { Archive, Attachment, Doc } from '../shared/types';
import { emptyDoc, normalizeDoc } from '../shared/types';

export const DATA_DIR = process.env.TASKTUI_HOME || join(homedir(), 'tasktui-data');
const TASKS = join(DATA_DIR, 'tasks.json');
const ARCHIVE = join(DATA_DIR, 'archive.json');
export const ATTACH_DIR = join(DATA_DIR, 'attachments');
const BACKUP_DIR = join(DATA_DIR, 'backups');

export class Conflict extends Error {
  constructor(public current: Doc) {
    super('conflict');
  }
}

let doc: Doc = emptyDoc();
let archive: Archive = { version: 1, tasks: [] };
let queue: Promise<unknown> = Promise.resolve();

/** Serialize all writes so two requests can't interleave. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Cannot read ${path}: ${(e as Error).message}`);
  }
}

/** Write to a temp file then rename, so a crash never leaves a half-written file. */
async function writeAtomic(path: string, data: unknown) {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  for (let i = 0; ; i++) {
    try {
      await fs.rename(tmp, path);
      return;
    } catch (e) {
      // Windows: antivirus or the indexer may briefly lock the file.
      if (i >= 5) throw e;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

export async function init() {
  for (const d of [DATA_DIR, ATTACH_DIR, BACKUP_DIR]) mkdirSync(d, { recursive: true });
  doc = normalizeDoc((await readJson<Doc>(TASKS)) ?? {});
  archive = (await readJson<Archive>(ARCHIVE)) ?? { version: 1, tasks: [] };
  if (!existsSync(TASKS)) await writeAtomic(TASKS, doc);
  await backup();
}

async function backup() {
  const target = join(BACKUP_DIR, `tasks-${toISODate(new Date())}.json`);
  if (!existsSync(target)) await fs.copyFile(TASKS, target);
  const files = (await fs.readdir(BACKUP_DIR)).filter((f) => /^tasks-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const extra = files.length - doc.settings.backups_keep;
  for (const f of files.slice(0, Math.max(0, extra))) await fs.unlink(join(BACKUP_DIR, f));
}

export const getDoc = () => doc;
export const getArchive = () => archive;

export function saveDoc(next: Doc): Promise<Doc> {
  return serial(async () => {
    if (next.rev !== doc.rev) throw new Conflict(doc);
    const saved = normalizeDoc({ ...next, rev: doc.rev + 1 });
    await writeAtomic(TASKS, saved);
    doc = saved;
    return doc;
  });
}

/** Apply a change on the server side (used by quick capture from the capture window). */
export function mutateDoc<T>(fn: (d: Doc) => T): Promise<{ doc: Doc; result: T }> {
  return serial(async () => {
    const next = structuredClone(doc);
    const result = fn(next);
    next.rev = doc.rev + 1;
    await writeAtomic(TASKS, next);
    doc = next;
    return { doc, result };
  });
}

/** Move tasks done more than `archive_after_days` ago into archive.json. */
export function archiveOld(rev: number): Promise<{ doc: Doc; moved: number }> {
  return serial(async () => {
    if (rev !== doc.rev) throw new Conflict(doc);
    const today = toISODate(new Date());
    const old = new Set(archiveCandidates(doc, today).map((t) => t.id));
    if (!old.size) return { doc, moved: 0 };
    const nextArchive: Archive = { version: 1, tasks: [...archive.tasks, ...doc.tasks.filter((t) => old.has(t.id))] };
    const nextDoc: Doc = { ...doc, rev: doc.rev + 1, tasks: doc.tasks.filter((t) => !old.has(t.id)) };
    // Archive first: if the second write fails, tasks exist twice rather than nowhere.
    await writeAtomic(ARCHIVE, nextArchive);
    await writeAtomic(TASKS, nextDoc);
    archive = nextArchive;
    doc = nextDoc;
    return { doc, moved: old.size };
  });
}

const pad = (n: number) => String(n).padStart(2, '0');

export async function storeAttachment(originalName: string, data: Buffer): Promise<Attachment> {
  const now = new Date();
  const clean = basename(originalName).replace(/[^\w.\- ]+/g, '_').trim() || 'file';
  const ext = extname(clean);
  const stem = clean.slice(0, clean.length - ext.length).slice(0, 60);
  const stamp = `${toISODate(now)}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let file = `${stamp}_${stem}${ext}`;
  for (let i = 2; existsSync(join(ATTACH_DIR, file)); i++) file = `${stamp}_${stem}-${i}${ext}`;
  await fs.writeFile(join(ATTACH_DIR, file), data);
  return { file, name: clean, added: toISODateTime(now) };
}

/** Resolve an attachment name to a path, refusing anything outside the attachments folder. */
export function attachmentPath(file: string): string | null {
  if (!file || file !== basename(file) || file.startsWith('.')) return null;
  const p = join(ATTACH_DIR, file);
  return existsSync(p) ? p : null;
}
