import { useState } from 'react';
import type { Settings as S } from '../../shared/types';
import { useStore } from '../store';
import { Modal } from './Modal';

const K = ({ k }: { k: string }) => <kbd>{k}</kbd>;

export function Help({ onClose }: { onClose: () => void }) {
  const row = (keys: string[], text: string) => (
    <tr>
      <td>{keys.map((k, i) => <K key={i} k={k} />)}</td>
      <td>{text}</td>
    </tr>
  );
  return (
    <Modal title="Keyboard shortcuts" wide onClose={onClose} onKey={(k) => (k === '?' ? (onClose(), true) : false)}>
      <div className="help" data-autofocus tabIndex={-1}>
        <div>
          <h3>Everywhere</h3>
          <table>
            <tbody>
              {row(['1'], 'Tasks view')}
              {row(['2', 'W'], 'Week view')}
              {row(['/', 'ctrl+k'], 'Search everything')}
              {row(['n'], "Today's note (selected day in Week)")}
              {row(['t'], 'New time correction')}
              {row(['u', 'ctrl+z'], 'Undo')}
              {row(['A'], 'Archive old done tasks')}
              {row([','], 'Settings')}
              {row(['?'], 'This help')}
              {row(['esc'], 'Leave a text field / close a dialog')}
            </tbody>
          </table>
          <h3>Tasks view</h3>
          <table>
            <tbody>
              {row(['a'], 'Add (quick capture)')}
              {row(['⏎', '⏎'], 'Mark done today (⏎ then ←/→ for another day)')}
              {row(['e'], 'Edit')}
              {row(['*'], 'Pin to / unpin from Today')}
              {row(['w'], 'Waiting on… (toggle)')}
              {row(['s'], 'Snooze until…')}
              {row(['o'], 'Open link / attachment')}
              {row(['f'], 'Attach files')}
              {row(['ctrl+v'], 'Paste screenshot / copied files onto the task')}
              {row(['d'], 'Delete')}
              {row(['alt+↑', 'alt+↓'], 'Move task (or drag)')}
              {row(['g'], 'Group by project / module / … / source')}
              {row(['S'], 'Sort: my order / due / newest')}
              {row(['tab'], 'Switch sidebar / list')}
              {row(['space'], 'Sidebar: combine labels')}
            </tbody>
          </table>
        </div>
        <div>
          <h3>Week view</h3>
          <table>
            <tbody>
              {row(['h', 'l'], 'Previous / next week')}
              {row(['.'], 'This week')}
              {row(['j', 'k'], 'Move between week note, days, corrections')}
              {row(['⏎'], 'Edit the selected note / correction')}
              {row(['e'], 'Edit week note')}
              {row(['t'], 'New time correction (selected day)')}
              {row(['space'], 'Correction entered in tracker ☑')}
              {row(['g'], 'Group done tasks by day / project / …')}
              {row(['c'], 'Copy week (for Teams / Outlook)')}
              {row(['x'], 'Export week as .md')}
            </tbody>
          </table>
          <h3>Quick capture</h3>
          <table>
            <tbody>
              <tr><td><code>#label #project:x</code></td><td>labels (aliases: #p: #m: #r:)</td></tr>
              <tr><td><code>@email</code></td><td>source: me email teams jira meeting</td></tr>
              <tr><td><code>PROJ-123</code> / URL</td><td>reference (Jira keys set source jira)</td></tr>
              <tr><td><code>^fri</code></td><td>due date</td></tr>
              <tr><td><code>~mon</code></td><td>snooze until</td></tr>
              <tr><td><code>*</code></td><td>pin to today</td></tr>
              <tr><td><code>every:fri</code></td><td>repeat: day weekday mon,thu month:1</td></tr>
            </tbody>
          </table>
          <h3>Dates</h3>
          <p>
            <code>today</code> <code>tomorrow</code> <code>yesterday</code> <code>mon</code>…<code>sun</code> <code>last fri</code>{' '}
            <code>+3</code> <code>-2</code> <code>+2w</code> <code>2026-11-20</code> <code>20/11</code>
          </p>
          <h3>Editing</h3>
          <p>
            In a text field single-key shortcuts are off. <K k="ctrl+⏎" /> saves, <K k="esc" /> leaves.
          </p>
        </div>
      </div>
    </Modal>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const { doc, update, dataDir } = useStore();
  const s = doc.settings;
  const [jira, setJira] = useState(s.jira_url);
  const [archiveDays, setArchiveDays] = useState(String(s.archive_after_days));
  const [keep, setKeep] = useState(String(s.backups_keep));
  const [aliases, setAliases] = useState(
    Object.entries(s.label_aliases)
      .map(([a, b]) => `${a}=${b}`)
      .join(', '),
  );
  const save = () => {
    const next: S = {
      ...s,
      jira_url: jira.trim(),
      archive_after_days: Math.max(1, Number(archiveDays) || 30),
      backups_keep: Math.max(1, Number(keep) || 14),
      label_aliases: Object.fromEntries(
        aliases
          .split(/[,\n]/)
          .map((p) => p.split('=').map((x) => x.trim().toLowerCase()))
          .filter((p) => p.length === 2 && p[0] && p[1]),
      ),
    };
    update('settings', (d) => void (d.settings = next));
    onClose();
  };
  return (
    <Modal
      title="Settings"
      onClose={onClose}
      onKey={(k) => (k === 'Enter' || k === 'ctrl+Enter' || k === 'ctrl+s' ? (save(), true) : false)}
      footer={<><kbd>⏎</kbd> save · <kbd>esc</kbd> cancel</>}
    >
      <div className="form">
        <label className="field">
          <span>Jira URL</span>
          <input value={jira} placeholder="https://yourcompany.atlassian.net/browse/" onChange={(e) => setJira(e.target.value)} />
        </label>
        <label className="field">
          <span>Archive after (days)</span>
          <input value={archiveDays} onChange={(e) => setArchiveDays(e.target.value)} />
        </label>
        <label className="field">
          <span>Backups to keep</span>
          <input value={keep} onChange={(e) => setKeep(e.target.value)} />
        </label>
        <label className="field">
          <span>Label aliases</span>
          <input value={aliases} placeholder="p=project, m=module, r=req" onChange={(e) => setAliases(e.target.value)} />
        </label>
        <div className="dim">Data folder: {dataDir}</div>
      </div>
    </Modal>
  );
}

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="overlay lightbox" tabIndex={-1} ref={(el) => el?.focus()} onClick={onClose} onKeyDown={(e) => (e.stopPropagation(), onClose())}>
      <img src={src} alt="" />
      <a href={src} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
        open in new window
      </a>
    </div>
  );
}
