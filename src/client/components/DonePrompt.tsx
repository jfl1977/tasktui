import { useState } from 'react';
import { addDays, parseDate, prettyDay, relDay } from '../../shared/dates';
import type { Task } from '../../shared/types';
import { Modal } from './Modal';

/**
 * "Done on:" prompt. Enter confirms (so Enter twice on a task = done today), ←/→ move the date,
 * typing switches to free entry ("-2", "fri", "2026-11-05"). On an already-done task, Delete reopens it.
 */
export function DonePrompt({
  task,
  today,
  onDone,
  onReopen,
  onClose,
}: {
  task: Task;
  today: string;
  onDone: (date: string) => void;
  onReopen: () => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(task.done ?? today);
  const [typed, setTyped] = useState<string | null>(null);
  const parsed = typed === null ? date : parseDate(typed, today);

  return (
    <Modal
      title={task.done ? 'Change done date' : 'Mark done'}
      onClose={onClose}
      onKey={(k) => {
        if (k === 'Enter') {
          if (parsed) {
            onClose();
            onDone(parsed);
          }
          return true;
        }
        if (typed === null) {
          if (k === 'ArrowLeft' || k === 'h' || k === 'ArrowDown') return setDate((d) => addDays(d, -1)), true;
          if (k === 'ArrowRight' || k === 'l' || k === 'ArrowUp') return setDate((d) => (d < today ? addDays(d, 1) : d)), true;
          if (k === 't') return setDate(today), true;
          if ((k === 'Delete' || k === 'Backspace') && task.done) return onClose(), onReopen(), true;
          if (/^[-+\w/.]$/.test(k)) return setTyped(k), true;
        } else {
          if (k === 'Backspace') return setTyped((t) => (t && t.length > 1 ? t.slice(0, -1) : null)), true;
          if (k.length === 1 || k === 'space') return setTyped((t) => (t ?? '') + (k === 'space' ? ' ' : k)), true;
        }
      }}
      footer={
        <>
          <kbd>⏎</kbd> confirm · <kbd>←</kbd>/<kbd>→</kbd> day · <kbd>t</kbd> today · type <code>-2</code> <code>fri</code>{' '}
          <code>2026-11-05</code>
          {task.done && (
            <>
              {' '}
              · <kbd>del</kbd> not done
            </>
          )}{' '}
          · <kbd>esc</kbd> cancel
        </>
      }
    >
      <div className="done-title">{task.title}</div>
      <div className="done-date" data-autofocus tabIndex={-1}>
        Done on{' '}
        {parsed ? (
          <strong>
            {prettyDay(parsed)} <span className="dim">({relDay(parsed, today)})</span>
          </strong>
        ) : (
          <span className="error">?</span>
        )}
        {typed !== null && <span className="typed"> ← {typed}▏</span>}
      </div>
      {parsed && parsed > today && <div className="error">That's in the future.</div>}
      {task.recur && <div className="dim">Repeats ({task.recur}): the next one will be created.</div>}
    </Modal>
  );
}
