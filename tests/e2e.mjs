// End-to-end smoke test: starts the built server on a temp data folder and drives the UI
// with the keyboard in headless Chrome/Chromium.
//   npm run build && npm run e2e        (CHROME=/path/to/chrome to choose the browser)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 8798;
const data = mkdtempSync(join(tmpdir(), 'tasktui-e2e-'));
const shots = process.env.SHOTS || data;
const chrome =
  process.env.CHROME || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

const server = spawn(process.execPath, ['dist/server.js'], { env: { ...process.env, TASKTUI_HOME: data, TASKTUI_PORT: String(PORT) } });
server.stderr.on('data', (d) => process.stderr.write(d));
process.on('exit', () => server.kill());
await new Promise((r) => server.stdout.once('data', r));

const browser = await chromium.launch({ executablePath: chrome });
const page = await browser.newPage({ viewport: { width: 1400, height: 820 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};
const json = () => JSON.parse(readFileSync(join(data, 'tasks.json'), 'utf8'));
const settle = () => page.waitForTimeout(250);
const key = async (...keys) => {
  for (const k of keys) await page.keyboard.press(k);
  await settle();
};

/** Paste a generated PNG as if it came from the clipboard (screenshot). */
const pasteImage = (selector) =>
  page.evaluate(async (sel) => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 120;
    const g = c.getContext('2d');
    g.fillStyle = '#4f7ccf';
    g.fillRect(0, 0, 200, 120);
    g.fillStyle = '#fff';
    g.font = '20px sans-serif';
    g.fillText('screenshot', 40, 65);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    const target = sel ? document.querySelector(sel) : document.body;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, selector);

await page.goto(`http://localhost:${PORT}`);
await page.waitForSelector('.app');
await key('1');

// Quick capture
for (const line of [
  'Fix export bug #p:apollo #req:marc PROJ-123 ^fri *',
  'Answer Marc about pricing #project:zeus @email',
  'Submit timesheet #admin every:fri ^today',
]) {
  await key('a');
  await page.keyboard.type(line);
  await key('Enter');
}
let doc = json();
check(doc.tasks.length === 3, 'quick capture adds 3 tasks');
const fix = doc.tasks.find((t) => t.title.startsWith('Fix'));
check(fix?.labels.join() === 'project:apollo,req:marc' && fix.source === 'jira' && fix.ref === 'PROJ-123' && fix.due && fix.today, 'quick capture parses labels, alias, Jira key, due, today');

// Label autocomplete
await key('a');
await page.keyboard.type('Write docs #ap');
await key('Tab');
check((await page.inputValue('.capture')) === 'Write docs #project:apollo ', 'label autocomplete with tab');
await key('Escape');

// Navigate and mark done with Enter Enter
await page.waitForSelector('.task');
const titles = await page.$$eval('.task .title', (els) => els.map((e) => e.textContent));
check(titles[0] === 'Submit timesheet', `newest task on top (${titles.join(' | ')})`);
await key('Home', 'Enter', 'Enter');
doc = json();
const done = doc.tasks.filter((t) => t.done);
check(done.length === 1 && done[0].title === 'Submit timesheet', 'Enter Enter marks done today');
check(doc.tasks.some((t) => t.title === 'Submit timesheet' && !t.done && t.due > done[0].done), 'recurring task creates the next one');

// Done on another day: Enter, ←, ←, Enter
await key('j');
const target = await page.$eval('.task.sel .title', (e) => e.textContent);
await key('Enter', 'ArrowLeft', 'ArrowLeft', 'Enter');
doc = json();
const t2 = doc.tasks.find((t) => t.title === target);
const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
check(t2?.done === iso(twoDaysAgo), `done with another date (${t2?.done})`);

// Undo
await key('u');
check(!json().tasks.find((t) => t.title === target).done, 'u undoes');

// Waiting on
await page.click(`.task:has-text("Answer Marc")`);
await key('w');
await page.keyboard.type('Marc');
await key('Enter');
check(json().tasks.find((t) => t.title.startsWith('Answer')).waiting?.on === 'Marc', 'w sets waiting on');

// Paste a screenshot onto the selected task
await pasteImage(null);
await page.waitForTimeout(600);
doc = json();
check(doc.tasks.find((t) => t.title.startsWith('Answer')).attachments.length === 1, 'ctrl+v screenshot attaches to task');
check(readdirSync(join(data, 'attachments')).length === 1, 'screenshot stored in attachments/');
await page.waitForSelector('.details .attachment img');

// Typing in a field doesn't trigger shortcuts
await key('e');
await page.focus('.modal input');
await page.keyboard.press('End');
await page.keyboard.type(' adwes');
await key('Control+Enter');
check(json().tasks.find((t) => t.title.startsWith('Answer')).title.endsWith('adwes'), 'shortcuts disabled while typing (a/d/w/e/s typed as text)');

// Group by and sidebar
await key('g');
check((await page.$$('.group-row')).length > 0, 'g groups the list');
await page.screenshot({ path: join(shots, '1-tasks.png') });
await key('g', 'g', 'g', 'g');

// Week view: day note with screenshot, time correction
await key('2');
await page.waitForSelector('.week-view');
await key('Enter'); // today's row → day note
await page.waitForSelector('.md-editor textarea');
await page.keyboard.type('Release meeting went fine.\n');
await pasteImage('.md-editor textarea');
await page.waitForTimeout(600);
await key('Escape');
doc = json();
const note = Object.values(doc.days)[0] ?? '';
check(note.includes('Release meeting') && note.includes('![screenshot.png](/attachments/'), 'day note saved with pasted screenshot inline');

await key('t');
await page.fill('.modal input >> nth=0', '9-11:30');
await page.fill('.modal input >> nth=2', 'Forgot the tracker: release meeting');
await key('Enter');
doc = json();
check(doc.time_corrections.length === 1 && doc.time_corrections[0].to.endsWith('11:30'), 'time correction added');
await page.waitForSelector('.corr');
await page.click('.corr');
await key('Space');
check(json().time_corrections[0].submitted === true, 'space marks correction as entered');
await key('e');
await page.keyboard.type('Highlights: shipped the export fix.');
await key('Escape');
check(Object.values(json().weeks)[0]?.includes('Highlights'), 'week note saved');
await page.screenshot({ path: join(shots, '2-week.png'), fullPage: true });

// Search
await key('/');
await page.keyboard.type('exprt bg');
await page.waitForSelector('.result');
const first = await page.$eval('.result .r-title', (e) => e.textContent);
check(first === 'Fix export bug PROJ-123', `fuzzy search finds "${first}"`);
await page.screenshot({ path: join(shots, '3-search.png') });
await key('Enter');
check((await page.$eval('.task.sel .title', (e) => e.textContent)) === 'Fix export bug PROJ-123', 'search jumps to the task');

await key('/');
await page.keyboard.type('#project:apollo is:open');
await page.waitForSelector('.result');
check((await page.$$('.result')).length === 1, 'search filters by label and status');
await key('Escape');

// Quick capture window: adds on the server, the main window picks it up on focus.
const cap = await browser.newPage({ viewport: { width: 720, height: 210 }, colorScheme: 'dark' });
cap.on('pageerror', (e) => errors.push(e.message));
await cap.goto(`http://localhost:${PORT}/capture`);
await cap.waitForSelector('.capture-app input');
await cap.keyboard.type('Reply to Teams thread #proj');
await cap.keyboard.press('Tab');
await cap.keyboard.type('@teams *');
await cap.keyboard.press('Shift+Enter');
await cap.waitForTimeout(400);
let captured = json().tasks.find((t) => t.title === 'Reply to Teams thread');
check(captured?.source === 'teams' && captured.labels[0] === 'project:apollo' && captured.today, 'capture window adds a task (autocomplete, source, today)');
await cap.screenshot({ path: join(shots, '5-capture.png') });
await cap.close();
await page.bringToFront();
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForTimeout(500);
await key('1');
check((await page.$$eval('.task .title', (els) => els.map((e) => e.textContent))).includes('Reply to Teams thread'), 'main window picks up the captured task');

// Follow-up nudge: make the waiting task 5 days old (as if set earlier), then refresh.
const res = await (await fetch(`http://localhost:${PORT}/api/data`)).json();
res.doc.tasks.find((t) => t.waiting).waiting.since = iso(new Date(Date.now() - 5 * 86400000));
await fetch(`http://localhost:${PORT}/api/data`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(res.doc) });
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForTimeout(500);
check((await page.$$('.waiting.stale')).length === 1, 'waiting 5 days shows the follow-up badge');
const summary = await (await fetch(`http://localhost:${PORT}/api/summary`)).json();
check(summary.text.includes('follow up: Marc (5d)'), `reminder text has follow-ups: "${summary.text}"`);

// Standup
await key('Escape', 'c');
await page.waitForSelector('.standup');
const stand = await page.$eval('.standup', (e) => e.textContent);
check(stand.includes('Yesterday') || stand.includes('Since'), 'standup has the previous day');
check(stand.includes('Today') && stand.includes('Reply to Teams thread'), 'standup lists Today');
check(stand.includes('waiting on Marc for 5 days'), 'standup lists blocked tasks');
await page.screenshot({ path: join(shots, '6-standup.png') });
await key('Escape');

await key('?');
await page.screenshot({ path: join(shots, '4-help.png') });
await key('Escape');

check(errors.length === 0, `no browser errors ${errors.length ? JSON.stringify(errors) : ''}`);
await browser.close();
server.kill();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed', `· data: ${data}`);
process.exit(failed ? 1 : 0);
