import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { relDay } from '../../shared/dates';
import { parseCapture } from '../../shared/parse';
import { useStore } from '../store';
import { Modal } from './Modal';

/** All labels in use, most used first. */
export function useAllLabels(): string[] {
  const { doc, archive } = useStore();
  return useMemo(() => {
    const count = new Map<string, number>();
    for (const t of [...doc.tasks, ...archive]) for (const l of t.labels) count.set(l, (count.get(l) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
  }, [doc.tasks, archive]);
}

/** Label suggestions for the "#word" under the cursor. */
export function useLabelComplete(value: string, cursor: number) {
  const { doc } = useStore();
  const all = useAllLabels();
  const before = value.slice(0, cursor);
  const m = before.match(/(?:^|\s)#([^\s#]*)$/);
  if (!m) return { word: null as string | null, items: [] as string[] };
  let q = m[1].toLowerCase();
  const i = q.indexOf(':');
  if (i > 0) q = (doc.settings.label_aliases[q.slice(0, i)] ?? q.slice(0, i)) + q.slice(i);
  const items = all.filter((l) => l.includes(q) && l !== q).slice(0, 8);
  return { word: m[1], items };
}

/**
 * Place the cursor right after React writes the new value (before the next keystroke), so fast
 * typing after a Tab completion lands in the right place.
 */
export function useCursorAfterRender(ref: RefObject<HTMLInputElement | null>) {
  const pending = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pending.current !== null && ref.current) {
      ref.current.setSelectionRange(pending.current, pending.current);
      pending.current = null;
    }
  });
  return (pos: number) => (pending.current = pos);
}

export function applyCompletion(value: string, cursor: number, word: string, label: string): [string, number] {
  const start = cursor - word.length;
  const next = value.slice(0, start) + label + ' ' + value.slice(cursor);
  return [next, start + label.length + 1];
}

export function QuickAdd({ onAdd, onClose }: { onAdd: (line: string) => void; onClose: () => void }) {
  const { today, doc } = useStore();
  const [v, setV] = useState('');
  const [cursor, setCursor] = useState(0);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const placeCursor = useCursorAfterRender(input);
  const c = parseCapture(v, today, doc.settings.label_aliases);
  const { word, items } = useLabelComplete(v, cursor);

  function complete(label: string) {
    const [next, pos] = applyCompletion(v, cursor, word!, label);
    setV(next);
    setCursor(pos);
    setSel(0);
    placeCursor(pos);
  }

  return (
    <Modal
      title="New task"
      wide
      onClose={onClose}
      onKey={(k) => {
        if (items.length && (k === 'Tab' || k === 'ArrowDown' || k === 'ArrowUp')) {
          if (k === 'Tab') complete(items[sel]);
          else setSel((s) => (s + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          return true;
        }
        if (k === 'Enter' || k === 'ctrl+Enter') {
          if (c.title.trim()) {
            onClose();
            onAdd(v);
          }
          return true;
        }
      }}
      footer={
        <>
          <code>#label</code> <code>#project:x</code> <code>@email</code> <code>PROJ-123</code> <code>^fri</code> due{' '}
          <code>~mon</code> snooze <code>*</code> today <code>every:fri</code> · <kbd>tab</kbd> complete · <kbd>⏎</kbd> add
        </>
      }
    >
      <input
        ref={input}
        className="capture"
        value={v}
        placeholder="Fix export bug #project:apollo @jira PROJ-123 ^fri"
        onChange={(e) => {
          setV(e.target.value);
          setCursor(e.target.selectionStart ?? e.target.value.length);
          setSel(0);
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
        {c.title && <span className="chip title">{c.title}</span>}
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
      </div>
      {c.errors.map((e) => (
        <div key={e} className="error">
          {e}
        </div>
      ))}
    </Modal>
  );
}
