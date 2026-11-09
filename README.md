# tasktui

A keyboard-first todo app for work that looks like a terminal app but runs in a browser window.
It has labels (`#project:apollo`), Enter-Enter to mark done, screenshots pasted with Ctrl+V,
day and week notes, a weekly summary to paste into Teams or Outlook, time-tracker corrections,
fuzzy search, archive, backups and undo. Everything stays on your computer in one JSON file plus
an attachments folder.

Full specification: [docs/SPEC.md](docs/SPEC.md). Press `?` in the app for all shortcuts.

## Use it on Windows (work PC)

Needs Node.js 20.19 or newer. `dist/` is committed, so no `npm install` is needed to run it.

```powershell
git clone <repo-url> tasktui
cd tasktui
powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
```

This creates:
- a **tasktui** Start menu shortcut with the hotkey **Ctrl+Alt+T**. It starts the server in the
  background and opens the app in its own Edge window.
- **reminder toasts** on weekdays at **08:30 and 15:30**.

Options: `-Hotkey "CTRL+ALT+Y"`, `-Times "08:00","16:00"`, `-Uninstall`.

To update later: `git pull`, then `scripts\tasktui.ps1 -Stop` (the next launch starts the new version).

Your data lives in `%USERPROFILE%\tasktui-data` (set `TASKTUI_HOME` to use another folder).

## Develop

```bash
npm install
npm run dev        # server on :8765 (auto-reload) + Vite on http://localhost:5173
npm test           # unit tests (vitest; needs Node 22.12+)
npm run build      # dist/server.js + dist/public
npm run e2e        # headless browser test against dist/ (Chrome/Chromium/Edge)
npm run typecheck
```

During development set `TASKTUI_HOME=./.dev-data` to keep test data out of your real folder.
Rebuild and commit `dist/` before pulling on the work PC.

## Quick capture

```
Fix export bug #p:apollo #req:marc @jira PROJ-123 ^fri ~mon * every:fri
```

`#label` · `@source` · `PROJ-123` / URL as reference · `^due` · `~snooze` · `*` today · `every:rule` repeat
