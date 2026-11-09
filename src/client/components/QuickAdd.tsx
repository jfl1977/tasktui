import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { relDay } from '../../shared/dates';
import { parseBulk, type Captured } from '../../shared/parse';
import { useStore } from '../store';
import { keyName } from '../util';
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
export function useCursorAfterRender(ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>) {
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

function Chips({ c, today, title = true }: { c: Captured; today: string; title?: boolean }) {
  return (
    <>
      {title && c.title && <span className="chip title">{c.title}</span>}
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
      {c.errors.map((e) => (
        <span key={e} className="chip error">
          {e}
        </span>
      ))}
    </>
  );
}

/**
 * The quick-capture text box shared by the add dialog and the capture window. One line = one
 * task; several lines (typed with Shift+Enter or pasted) = several tasks, with bullets stripped
 * and token-only lines applied to all. Enter submits, Ctrl+Enter submits with `stay`.
 */
export function CaptureBox({
  onSubmit,
  extra,
  placeholder,
}: {
  onSubmit: (text: string, count: number, stay: boolean) => void;
  extra?: ReactNode;
  placeholder?: string;
}) {
  const { today, doc } = useStore();
  const [v, setV] = useState('');
  const [cursor, setCursor] = useState(0);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const placeCursor = useCursorAfterRender(box);
  const bulk = parseBulk(v, today, doc.settings.label_aliases);
  const { word, items } = useLabelComplete(v, cursor);
  const rows = Math.min(12, Math.max(1, v.split('\n').length));

  function complete(label: string) {
    const [next, pos] = applyCompletion(v, cursor, word!, label);
    setV(next);
    setCursor(pos);
    setSel(0);
    placeCursor(pos);
  }

  return (
    <div className="capture-box">
      <textarea
        ref={box}
        className="capture"
        rows={rows}
        value={v}
        data-autofocus
        placeholder={placeholder ?? 'Fix export bug #project:apollo @jira PROJ-123 ^fri   (paste a list for several)'}
        onChange={(e) => {
          setV(e.target.value);
          setCursor(e.target.selectionStart ?? e.target.value.length);
          setSel(0);
        }}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          const k = keyName(e);
          const stop = () => (e.preventDefault(), e.stopPropagation());
          if (items.length && (k === 'Tab' || k === 'ArrowDown' || k === 'ArrowUp')) {
            stop();
            if (k === 'Tab') complete(items[sel]);
            else setSel((s) => (s + (k === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
          } else if (k === 'Enter' || k === 'ctrl+Enter') {
            stop();
            if (bulk.items.length) {
              onSubmit(v, bulk.items.length, k === 'ctrl+Enter');
              setV('');
            }
          }
          // shift+Enter: default behaviour, a new line
        }}
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
      {bulk.items.length <= 1 ? (
        <div className="chips">
          {bulk.items[0] && <Chips c={bulk.items[0]} today={today} />}
          {extra}
        </div>
      ) : (
        <div className="bulk-preview">
          <div className="dim">
            {bulk.items.length} tasks
            {(bulk.common.labels.length || bulk.common.source || bulk.common.due || bulk.common.today) && ' · for all: '}
            <Chips c={bulk.common} today={today} title={false} />
          </div>
          <ol>
            {bulk.items.map((c, i) => (
              <li key={i}>
                <span className="b-title">{c.title}</span> <Chips
                  c={{
                    ...c,
                    // Show only what differs from the "for all" line.
                    labels: c.labels.filter((l) => !bulk.common.labels.includes(l)),
                    source: c.source === bulk.common.source ? null : c.source,
                    due: c.due === bulk.common.due ? null : c.due,
                    snooze_until: c.snooze_until === bulk.common.snooze_until ? null : c.snooze_until,
                    today: c.today && !bulk.common.today,
                    recur: c.recur === bulk.common.recur ? null : c.recur,
                  }}
                  today={today}
                  title={false}
                />
              </li>
            ))}
          </ol>
          {extra && <div className="chips">{extra}</div>}
        </div>
      )}
    </div>
  );
}

export function QuickAdd({ onAdd, onClose }: { onAdd: (text: string) => void; onClose: () => void }) {
  return (
    <Modal
      title="New task"
      wide
      onClose={onClose}
      footer={
        <>
          <code>#label</code> <code>#p:x</code> <code>@email</code> <code>PROJ-123</code> <code>^fri</code> due <code>~mon</code> snooze{' '}
          <code>*</code> today <code>every:fri</code> · <kbd>tab</kbd> complete · <kbd>shift+⏎</kbd> new line = another task · a line
          with only tokens applies to all · <kbd>⏎</kbd> add
        </>
      }
    >
      <CaptureBox
        onSubmit={(text) => {
          onClose();
          onAdd(text);
        }}
      />
    </Modal>
  );
}
