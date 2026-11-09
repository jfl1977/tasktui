import { serve } from '@hono/node-server';
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { formatDuration, toISODate, toISODateTime } from '../shared/dates';
import { addText, summarize } from '../shared/logic';
import type { Attachment, Doc } from '../shared/types';
import { archiveOld, attachmentPath, Conflict, DATA_DIR, getArchive, getDoc, init, mutateDoc, saveDoc, storeAttachment } from './storage';

const PORT = Number(process.env.TASKTUI_PORT || 8765);
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public'); // dist/public in production

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};
const mime = (p: string) => MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof Conflict) return c.json({ error: 'conflict', doc: err.current }, 409);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

app.get('/api/ping', (c) => c.json({ ok: true, app: 'tasktui' }));

app.get('/api/data', (c) => c.json({ doc: getDoc(), archive: getArchive().tasks, dataDir: DATA_DIR }));

app.put('/api/data', async (c) => c.json({ doc: await saveDoc((await c.req.json()) as Doc) }));

/** Quick capture from the small capture window: the server adds the task, so no rev juggling. */
app.post('/api/capture', async (c) => {
  // `text` may hold several lines (bulk add); `line` is accepted for older clients.
  const body = (await c.req.json()) as { text?: string; line?: string; attachments?: Attachment[] };
  const text = body.text ?? body.line ?? '';
  const now = new Date();
  const { doc, result } = await mutateDoc((d) => addText(d, text, toISODate(now), toISODateTime(now), body.attachments ?? []));
  if (!result.length) return c.json({ error: 'No task title found' }, 400);
  return c.json({ tasks: result, rev: doc.rev });
});

app.post('/api/archive', async (c) => {
  const { rev } = (await c.req.json()) as { rev: number };
  const { doc, moved } = await archiveOld(rev);
  return c.json({ doc, archive: getArchive().tasks, moved });
});

app.post('/api/attachments', async (c) => {
  const name = c.req.query('name') || 'file';
  const data = Buffer.from(await c.req.arrayBuffer());
  if (!data.length) return c.json({ error: 'empty file' }, 400);
  return c.json(await storeAttachment(name, data));
});

app.get('/attachments/:file', async (c) => {
  const p = attachmentPath(c.req.param('file'));
  if (!p) return c.notFound();
  return c.body(await fs.readFile(p), 200, { 'content-type': mime(p), 'cache-control': 'max-age=31536000, immutable' });
});

/** Open an attachment with the default Windows/macOS/Linux app (for .msg, .docx, ...). */
app.post('/api/open', async (c) => {
  const { file } = (await c.req.json()) as { file: string };
  const p = attachmentPath(file);
  if (!p) return c.json({ error: 'not found' }, 404);
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [p]] : process.platform === 'darwin' ? ['open', [p]] : ['xdg-open', [p]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  return c.json({ ok: true });
});

/** Counts for the 8:30 / 15:30 reminder toast. */
app.get('/api/summary', (c) => {
  const s = summarize(getDoc(), toISODate(new Date()));
  const parts = [`${s.today} for today`];
  if (s.overdue) parts.push(`${s.overdue} overdue`);
  if (s.waiting) parts.push(`${s.waiting} waiting`);
  if (s.followUps.length) parts.push(`follow up: ${s.followUps.map((f) => `${f.on} (${f.days}d)`).join(', ')}`);
  if (s.dueTomorrow) parts.push(`${s.dueTomorrow} due tomorrow`);
  if (s.pendingCorrections) parts.push(`${formatDuration(s.pendingMinutes)} of time corrections not submitted`);
  // ASCII separator: Windows PowerShell 5.1 may decode the response as Latin-1.
  return c.json({ ...s, text: parts.join(' - ') });
});

// Built client (production). In development Vite serves it and proxies /api here.
app.get('*', async (c) => {
  if (!existsSync(PUBLIC)) return c.text('Client not built. Run "npm run build", or use "npm run dev".', 404);
  const rel = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, '');
  let p = join(PUBLIC, rel);
  if (!p.startsWith(PUBLIC) || !rel || !existsSync(p) || (await fs.stat(p)).isDirectory()) p = join(PUBLIC, 'index.html');
  return c.body(await fs.readFile(p), 200, { 'content-type': mime(p) });
});

await init();
const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`tasktui running on http://localhost:${PORT}  (data: ${DATA_DIR})`);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use: tasktui is probably already running. Open http://localhost:${PORT}`);
    process.exit(1);
  }
  throw e;
});
// The server only listens on 127.0.0.1, so it's reachable from this computer only.
