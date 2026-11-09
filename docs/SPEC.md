# tasktui: specification

A simple but powerful, keyboard-first todo app for work. It is a local web app that looks and
feels like a terminal app: a small Node server on `localhost` serves a React page and stores
everything in one JSON file plus an attachments folder. Nothing leaves the computer.

Target: Windows 11 at work (Node 20.19+, Edge), also runs on Linux/macOS.

Keep this document up to date when behaviour changes. It is the reference for future work.

---

## 1. Concepts

### 1.1 Task

| Field | Type | Meaning |
|---|---|---|
| `id` | string | random id |
| `title` | string | required |
| `description` | markdown | may contain pasted images `![](/attachments/…)` |
| `labels` | string[] | `urgent` or typed `project:apollo`, lowercase |
| `source` | string | where it came from: `me` (default), `email`, `teams`, `jira`, `meeting`, or any word |
| `ref` | string | Jira key (`PROJ-123`), URL, or free text |
| `created` | datetime | |
| `due` | date \| null | |
| `snooze_until` | date \| null | hidden from lists until that date |
| `today` | date \| null | pinned to Today on that date; stays on Today until done or unpinned |
| `waiting` | `{on, since}` \| null | blocked on someone/something |
| `recur` | string \| null | repeat rule, see 1.3 |
| `done` | date \| null | the day it was finished (can be in the past) |
| `order` | number | manual order in normal lists |
| `today_order` | number | manual order in the Today list |
| `attachments` | `{file, name, added}`[] | files in `attachments/` |

### 1.2 Labels

- Plain `#urgent` or typed `#type:value`, e.g. `#project:apollo #module:billing #req:marc`.
- Type aliases (settings), default `p → project`, `m → module`, `r → req`: `#p:apollo` = `#project:apollo`.
- Every label type automatically becomes a sidebar section and a "group by" option.

### 1.3 Repeat rules (`recur`)

`day`, `weekday` (Mon–Fri), `week`, `mon` / `mon,thu` (weekdays), `month` (same day of month),
`month:15` (clamped to the month's last day).
Marking a repeating task done creates a copy with `due` = next occurrence after
max(done date, current due). The copy has no attachments, waiting, snooze or today pin.

### 1.4 Dates

Accepted wherever a date is typed: `today`, `tomorrow`/`tom`, `yesterday`, `mon`…`sun` / `friday`
(next one, never today), `last fri`, `+3`, `-2`, `+2w`, `2026-11-20`, `20/11`, `20/11/26`.
Date-times: `9:00`, `14h30`, `mon 9:00`, `yesterday 14`. Ranges: `today 9-11:30`, `mon 9:00-10h`.
Weeks are ISO weeks (Monday start), keyed `2026-W45`.

### 1.5 Day notes, week notes

Free Markdown text per day (`days["2026-11-08"]`) and per week (`weeks["2026-W45"]`).
Screenshots can be pasted into them.

### 1.6 Time corrections

For forgotten time-tracker entries: `from`, `to` (datetimes), `reason` (required), optional linked
`task`, `submitted` (ticked once entered in the real tracker). Shown in the week of `from`, with
totals and the amount not entered yet.

---

## 2. Screens

Top bar: `[1] Tasks`, `[2] Week`, search, help. Bottom status bar: mode (`NAV`/`EDIT`/`DIALOG`),
key hints for the current context or the last message, and the save state.
Everything else opens as a dialog over the current view.

### 2.1 Tasks view

Three columns: sidebar, task list, details of the selected task.

Sidebar entries (counts = open, not snoozed):
- ★ Today: open tasks pinned on or before today, or due on or before today (not snoozed)
- ▢ Inbox: all open, not snoozed tasks
- ⏳ Waiting · 💤 Snoozed · ✓ Done (newest first) · ∗ Everything
- one section per label type, then plain labels, then sources

Label entries can be combined (space or Ctrl+click): the list shows tasks having all of them.
Labels only used by done tasks stay listed with count 0.

List rows: status (☐ / ⏳ / ✓), ★ if pinned, title, labels, then waiting person and days, ref,
source, ↻, 💤 date, due (red when overdue, yellow today), done date, 📎 count.

Sort (`S`): my order (default) → due date → newest. Group (`g`): none → each label type → source.
Reordering (Alt+↑/↓, Shift+J/K or mouse drag) requires "my order" and no grouping.
The Today list has its own order.

Adding a task (`a`) from a label, source or Today view pre-fills that label, source or pin.
New tasks go to the top of the list.

### 2.2 Week view

Mon–Sun of one week: the week note, then one block per day (day note + tasks done that day,
archived ones included), then time corrections with the total. The cursor (j/k) moves over the
week note, the 7 days and each correction. Grouping (`g`) shows done tasks by label type/source
for the whole week instead of per day.

Copy (`c`) puts the week on the clipboard as HTML (images inlined as data URIs, for
Outlook/Teams) and as Markdown text. Export (`x`) downloads `week-2026-W45.md`. Days without
notes or tasks are left out of the copy.

### 2.3 Dialogs

| Dialog | Behaviour |
|---|---|
| Quick capture | one line, see 3. Live preview chips, label autocomplete on `#` (Tab) |
| Done | "Done on" today. ⏎ confirms, ←/→ (h/l) ±1 day (no future), `t` today, typing switches to free entry (`-2`, `fri`). On a done task: Del reopens |
| Edit | all fields + Markdown description + attachments. Ctrl+⏎ saves. Esc with unsaved changes asks for a second Esc |
| Waiting on | name/what. `w` on a waiting task clears it |
| Snooze | date after today, empty = remove |
| Open (`o`) | Jira link (needs Jira URL in settings), URLs and attachments. One target opens directly, several show a numbered menu |
| Note editor | Markdown with live preview (Ctrl+P toggles). Esc / Ctrl+⏎ / Ctrl+S save and close |
| Time correction | From, To, Reason, Task. `today 9-11:30` in From fills both. A bare time means the selected day. "To" without a date uses From's date |
| Search | see 5 |
| Settings (`,`) | Jira URL, archive after N days, backups to keep, label aliases, shows the data folder |
| Help (`?`) | all shortcuts |

---

## 3. Quick capture syntax

```
Fix export bug #clientx #p:apollo @jira PROJ-123 ^fri ~mon * every:fri
```

| Token | Meaning |
|---|---|
| `#word`, `#type:value` | label |
| `@word` | source |
| `ABC-123` | Jira key: becomes `ref`, sets source `jira` unless `@source` given; stays in the title |
| `http(s)://…` | becomes `ref` (removed from the title) |
| `^date` | due |
| `~date` | snooze until |
| `*` | pin to today |
| `every:rule` | repeat |

Invalid dates/rules are reported and left in the title so nothing typed is lost.

---

## 4. Keyboard

### 4.1 Modes

- **NAV**: no text field focused. Single-key shortcuts are active.
- **EDIT**: a text field has focus. Single-key shortcuts are off. Esc leaves the field.
- **DIALOG**: a dialog is open. Its own keys apply; Esc closes it.
- Always: Ctrl+K search, Ctrl+S never opens the browser's "Save page".

### 4.2 Global (NAV)

| Key | Action |
|---|---|
| `1` / `2` or `W` | Tasks / Week view |
| `/`, Ctrl+K | search |
| `u`, Ctrl+Z | undo (unlimited within the session, 200 steps) |
| `n` | today's note (Tasks view) |
| `t` | new time correction (Tasks view: today; Week view: selected day) |
| `A` | archive old done tasks |
| `,` | settings |
| `?` | help |

### 4.3 Tasks view

| Key | Action |
|---|---|
| `j`/`k`, ↓/↑, Home/End, PgUp/PgDn | move |
| Tab | switch sidebar / list |
| `a` | quick capture |
| ⏎ | done dialog (⏎ ⏎ = done today) |
| `e` / double-click | edit |
| `*` | pin / unpin today |
| `w` | waiting on (toggle) |
| `s` | snooze |
| `o` | open link / attachment |
| `f` | attach files (file picker) |
| Ctrl+V | attach screenshots / files copied in Explorer to the selected task |
| drop files | attach to the row they're dropped on (or the selected task) |
| `d` / Del | delete (confirm) |
| Alt+↑/↓, `K`/`J` | move task |
| `g` | cycle grouping |
| `S` | cycle sort |
| Sidebar: ⏎/`l`/→ | show that entry |
| Sidebar: space | combine labels |

### 4.4 Week view

| Key | Action |
|---|---|
| `h`/`l`, ←/→ | previous / next week |
| `.` / `T` | this week |
| `j`/`k` | move cursor |
| ⏎ | edit the item under the cursor |
| `e` | week note |
| `n` | note of the selected day |
| `t` | new time correction |
| space | correction entered in tracker (toggle) |
| `d` | delete correction (confirm) |
| `g` | group done tasks by day / label type / source |
| `c` | copy week |
| `x` | export week as Markdown |

---

## 5. Search

Fuzzy (uFuzzy, up to 2 missing letters per word, words in any order) over task titles, labels,
source, ref, description, waiting-on, attachment names, archived tasks, day and week notes and
time-correction reasons. Open tasks rank before done/archived ones.

Filters (combine with text): `#project:apollo` (exact), `#project:` (any value of that type),
`@jira`, `is:open`, `is:done`, `is:waiting`, `is:snoozed`, `is:today`, `is:archived`.
With filters and no text, matching tasks are listed.

⏎ on a result: active task → Tasks view with the task selected; archived task → read-only
details; day/week note or correction → Week view at that item.

---

## 6. Attachments and the clipboard

- Browsers paste images natively, so Ctrl+V of a screenshot works in task descriptions, notes
  and on the selected task (NAV mode).
- Pasted images are named `screenshot.png`; stored as `YYYY-MM-DD_HHMMSS_<name>` in `attachments/`.
- In Markdown fields, pasted/dropped files are inserted at the cursor: images as `![name](url)`,
  others as `[📎 name](url)`. In the edit dialog they're also added to the task's attachment list.
- Opening: images in the in-app viewer (click/Esc to close), PDF/text in a browser tab,
  anything else (.msg, .docx, .xlsx…) with its Windows app via the server (`/api/open`).
- Removing an attachment from a task does not delete the file (undo stays possible).

---

## 7. Storage

Data folder: `TASKTUI_HOME`, default `%USERPROFILE%\tasktui-data` (`~/tasktui-data`).
It's separate from the code, so work data never ends up in git.

```
tasktui-data/
  tasks.json        everything except archived tasks
  archive.json      archived tasks
  attachments/      pasted / attached files
  backups/          tasks-YYYY-MM-DD.json, one per day the app starts, last 14 kept
```

`tasks.json`:

```json
{
  "version": 1,
  "rev": 42,
  "settings": {
    "archive_after_days": 30,
    "backups_keep": 14,
    "jira_url": "https://yourcompany.atlassian.net/browse/",
    "label_aliases": { "p": "project", "m": "module", "r": "req" }
  },
  "tasks": [ { "id": "…", "title": "…", "…": "see 1.1" } ],
  "days":  { "2026-11-08": "markdown" },
  "weeks": { "2026-W45": "markdown" },
  "time_corrections": [
    { "id": "…", "from": "2026-11-03T09:00", "to": "2026-11-03T11:30",
      "reason": "Forgot the tracker", "task": null, "submitted": false }
  ]
}
```

Safety:
- Every change is saved immediately (the client sends the whole document).
- Writes go to a temp file then are renamed (retried if Windows briefly locks the file).
- `rev` is checked on save: if another window saved in between, the server refuses (409) and the
  client reloads the latest version and says so.
- Archive (`A`, or offered once a day at startup when there are candidates) moves tasks done more
  than `archive_after_days` ago to `archive.json`, writing the archive first.

---

## 8. Server API

Listens on `127.0.0.1:${TASKTUI_PORT:-8765}` only.

| Method | Path | |
|---|---|---|
| GET | `/api/ping` | `{ok, app:"tasktui"}` (used by the launcher) |
| GET | `/api/data` | `{doc, archive, dataDir}` |
| PUT | `/api/data` | save the whole doc; body `rev` must match; returns `{doc}` with new `rev`, or 409 `{doc}` |
| POST | `/api/archive` | `{rev}` → `{doc, archive, moved}` |
| POST | `/api/attachments?name=x.png` | raw body → `{file, name, added}` |
| GET | `/attachments/:file` | file content (no path traversal) |
| POST | `/api/open` | `{file}` opens it with the OS default app |
| GET | `/api/summary` | counts + `text` for the reminder toast |
| GET | `/*` | built client (`dist/public`) |

---

## 9. Windows integration

`scripts/` (ASCII-only, because Windows PowerShell 5.1 misreads UTF-8 without a BOM):

- `tasktui.ps1`: starts `node dist/server.js` hidden if `/api/ping` doesn't answer (log in
  `%TEMP%\tasktui.log`), then opens `msedge --app=http://localhost:8765` (falls back to the
  default browser). `-NoOpen` only starts, `-Stop` stops.
- `reminder.ps1`: starts the server if needed, reads `/api/summary`, shows a toast
  ("3 for today - 2 waiting - 2h30 of time corrections not submitted"). Clicking opens the app
  in the default browser.
- `install-windows.ps1`: Start menu shortcut with hotkey (default Ctrl+Alt+T) and a scheduled
  task with weekday triggers at 08:30 and 15:30 (`-Hotkey`, `-Times`, `-Uninstall`).
  Current user, no admin.

---

## 10. Code layout

```
src/shared/   types.ts, dates.ts, parse.ts (quick capture), recur.ts, logic.ts (views, done, summary)
src/server/   index.ts (Hono routes), storage.ts (files, backups, archive, attachments)
src/client/   React app: App.tsx (tabs, global keys, dialogs), store.tsx (state, save, undo),
              components/ (TasksView, WeekView, dialogs), weekReport.ts (copy/export)
tests/        shared.test.ts (vitest), e2e.mjs (headless browser, keyboard-driven)
scripts/      Windows launcher, reminder, installer
dist/         build output: server.js (bundled, no node_modules needed) + public/
```

Build: `vite build` for the client, `esbuild` bundles the server into one file.
Dev: `npm run dev` (server with reload on :8765 + Vite on :5173 with proxy).

---

## 11. Not done yet / ideas

- Clicking the reminder toast opens the default browser, not the Edge app window.
- Images in the week copy are inlined as data URIs; some targets (Teams) may drop them.
- Removed attachments' files are never cleaned up.
- No multi-device sync (put `TASKTUI_HOME` on OneDrive if needed; only one machine at a time).
