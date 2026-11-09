import { useEffect, useRef, useState } from 'react';
import { relDay } from '../../shared/dates';
import { parseCapture } from '../../shared/parse';
import type { Attachment } from '../../shared/types';
import { attachmentUrl, filesFrom, isImage } from '../api';
import { useStore } from '../store';
import { keyName } from '../util';
import { uploadAll } from './MarkdownEditor';
import { applyCompletion, useCursorAfterRender, useLabelComplete } from './QuickAdd';

/**
 * The small "capture from anywhere" window (opened by its own hotkey at /capture).
 * Enter adds the task and closes the window, Shift+Enter adds and stays open for another,
 * Ctrl+V attaches a screenshot to the task being captured, Esc closes.
 */
export function CaptureApp() {
  const { today, doc, notify } = useStore();
  const [v, setV] = useState('');
  const [cursor, setCursor] = useState(0);
  const [sel, setSel] = useState(0);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const placeCursor = useCursorAfterRender(input);
  const c = parseCapture(v, today, doc.settings.label_aliases);
  const { word, items } = useLabelComplete(v, cursor);

  useEffect(() => {
    document.title = 'tasktui · capture';
    input.current?.focus();
    // Windows may open the window behind others; grab focus when shown.
    const f = () => input.current?.focus();
    window.addEventListener('focus', f);
    return () => window.removeEventListener('focus', f);
  }, []);

  function complete(label: string) {
    const [next, pos] = applyCompletion(v, cursor, word!, label);
    setV(next);
    setCursor(pos);
    setSel(0);
    placeCursor(pos);
  }

  async function add(stay: boolean) {
    if (!c.title.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ line: v, attachments: atts }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setV('');
      setAtts([]);
      setStatus(`✓ Added "${c.title}"`);
      if (!stay) {
        window.close();
        // If the browser refuses to close a window it didn't open, stay usable.
        setTimeout(() => setStatus(`✓ Added "${c.title}". You can close this window.`), 300);
      }
    } catch (e) {
      notify(`Could not add: ${(e as Error).message}`, 'error');
      setStatus(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <div
      className="capture-app"
      onKeyDown={(e) => {
        const k = keyName(e);
        if (items.length && (k === 'Tab' || k === 'ArrowDown' || k === 'ArrowUp')) {
          e.preventDefault();
          if (k === 'Tab') complete(items[sel]);
          else setSel((s) => (s + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
        } else if (k === 'Enter' || k === 'shift+Enter') {
          e.preventDefault();
          void add(k === 'shift+Enter');
        } else if (k === 'Escape') {
          e.preventDefault();
          window.close();
        }
      }}
      onPaste={async (e) => {
        const files = filesFrom(e.clipboardData);
        if (!files.length) return;
        e.preventDefault();
        setStatus('Uploading…');
        const up = await uploadAll(files, notify);
        setAtts((a) => [...a, ...up]);
        setStatus('');
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        const files = filesFrom(e.dataTransfer);
        if (!files.length) return;
        e.preventDefault();
        const up = await uploadAll(files, notify);
        setAtts((a) => [...a, ...up]);
      }}
    >
      <input
        ref={input}
        className="capture"
        value={v}
        placeholder="New task… #project:x @teams PROJ-123 ^fri *"
        onChange={(e) => {
          setV(e.target.value);
          setCursor(e.target.selectionStart ?? e.target.value.length);
          setSel(0);
          setStatus('');
        }}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
      />
      {items.length > 0 && (
        <div className="complete">
          {items.map((l, i) => (
            <div key={l} className={i === sel ? 'sel' : ''} onMouseDown={(e) => (e.preventDefault(), complete(l))}>
              #{l}
            </div>
          ))}
        </div>
      )}
      <div className="chips">
        {c.labels.map((l) => (
          <span key={l} className="chip label">
            #{l}
          </span>
        ))}
        {c.source && <span className="chip">@{c.source}</span>}
        {c.ref && <span className="chip">{c.ref}</span>}
        {c.due && <span className="chip">due {relDay(c.due, today)}</span>}
        {c.snooze_until && <span className="chip">snoozed until {relDay(c.snooze_until, today)}</span>}
        {c.today && <span className="chip">★ today</span>}
        {c.recur && <span className="chip">↻ {c.recur}</span>}
        {atts.map((a) =>
          isImage(a.name) ? (
            <img key={a.file} className="capture-thumb" src={attachmentUrl(a.file)} alt={a.name} />
          ) : (
            <span key={a.file} className="chip">
              📎 {a.name}
            </span>
          ),
        )}
        {c.errors.map((e) => (
          <span key={e} className="chip error">
            {e}
          </span>
        ))}
      </div>
      <div className="capture-foot">
        <span className={status.startsWith('✗') ? 'error' : 'preview'}>{status}</span>
        <span className="dim">⏎ add · shift+⏎ add another · ctrl+v screenshot · esc close</span>
      </div>
    </div>
  );
}
