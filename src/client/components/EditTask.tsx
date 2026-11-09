import { useRef, useState } from 'react';
import { parseDate, relDay } from '../../shared/dates';
import { normalizeLabel } from '../../shared/parse';
import { isValidRecur } from '../../shared/recur';
import { SOURCES, type Attachment, type Task } from '../../shared/types';
import { useStore } from '../store';
import { AttachmentList } from './Attachments';
import { MarkdownEditor, uploadAll } from './MarkdownEditor';
import { Modal } from './Modal';
import { applyCompletion, useCursorAfterRender, useLabelComplete } from './QuickAdd';

type Form = {
  title: string;
  labels: string;
  source: string;
  ref: string;
  due: string;
  snooze: string;
  recur: string;
  waiting: string;
  description: string;
  attachments: Attachment[];
};

function toForm(t: Task): Form {
  return {
    title: t.title,
    labels: t.labels.map((l) => '#' + l).join(' '),
    source: t.source,
    ref: t.ref,
    due: t.due ?? '',
    snooze: t.snooze_until ?? '',
    recur: t.recur ?? '',
    waiting: t.waiting?.on ?? '',
    description: t.description,
    attachments: t.attachments,
  };
}

export function EditTask({ task, onSave, onClose }: { task: Task; onSave: (t: Task) => void; onClose: () => void }) {
  const { today, doc, notify } = useStore();
  const [f, setF] = useState<Form>(() => toForm(task));
  const [armed, setArmed] = useState(false); // Esc pressed once with unsaved changes
  const [cursor, setCursor] = useState(0);
  const labelsRef = useRef<HTMLInputElement>(null);
  const placeCursor = useCursorAfterRender(labelsRef);
  const fileRef = useRef<HTMLInputElement>(null);
  const { word, items } = useLabelComplete(f.labels, cursor);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setArmed(false);
  };
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(task));

  const date = (s: string) => (s.trim() ? parseDate(s, today) : null);
  const errors: string[] = [];
  if (!f.title.trim()) errors.push('Title is empty');
  if (f.due.trim() && !date(f.due)) errors.push(`Unknown due date "${f.due}"`);
  if (f.snooze.trim() && !date(f.snooze)) errors.push(`Unknown snooze date "${f.snooze}"`);
  if (f.recur.trim() && !isValidRecur(f.recur)) errors.push(`Unknown repeat rule "${f.recur}"`);

  function save() {
    if (errors.length) return notify(errors[0], 'error');
    const labels = [
      ...new Set(
        f.labels
          .split(/[\s,]+/)
          .filter((x) => x.replace('#', ''))
          .map((x) => normalizeLabel(x, doc.settings.label_aliases)),
      ),
    ];
    const waitingOn = f.waiting.trim();
    onSave({
      ...task,
      title: f.title.trim(),
      labels,
      source: f.source.trim().toLowerCase() || 'me',
      ref: f.ref.trim(),
      due: date(f.due),
      snooze_until: date(f.snooze),
      recur: f.recur.trim().toLowerCase() || null,
      waiting: waitingOn ? { on: waitingOn, since: task.waiting?.since ?? today } : null,
      description: f.description,
      attachments: f.attachments,
    });
    onClose();
  }

  const datePreview = (s: string) => {
    const d = date(s);
    return s.trim() ? (d ? relDay(d, today) : '?') : '';
  };

  return (
    <Modal
      title="Edit task"
      wide
      onClose={() => {
        if (!dirty || armed) onClose();
        else setArmed(true);
      }}
      onKey={(k) => {
        if (k === 'ctrl+Enter' || k === 'ctrl+s') return save(), true;
        if (items.length && k === 'Tab' && document.activeElement === labelsRef.current) {
          const [next, pos] = applyCompletion(f.labels, cursor, word!, items[0]);
          set('labels', next);
          setCursor(pos);
          placeCursor(pos);
          return true;
        }
      }}
      footer={
        armed ? (
          <span className="error">Unsaved changes: press Esc again to discard, Ctrl+Enter to save.</span>
        ) : (
          <>
            <kbd>tab</kbd> next field · <kbd>ctrl+⏎</kbd> save · <kbd>esc</kbd> cancel
          </>
        )
      }
    >
      <div className="form">
        <label className="field">
          <span>Title</span>
          <input value={f.title} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="field">
          <span>Labels</span>
          <input
            ref={labelsRef}
            value={f.labels}
            placeholder="#urgent #project:apollo #req:marc"
            onChange={(e) => {
              set('labels', e.target.value);
              setCursor(e.target.selectionStart ?? 0);
            }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
          />
        </label>
        {items.length > 0 && document.activeElement === labelsRef.current && (
          <div className="complete inline">{items.map((l) => '#' + l).join('  ')} · tab</div>
        )}
        <div className="row">
          <label className="field">
            <span>Source</span>
            <input list="sources" value={f.source} onChange={(e) => set('source', e.target.value)} />
            <datalist id="sources">
              {SOURCES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Ref</span>
            <input value={f.ref} placeholder="PROJ-123 or a link" onChange={(e) => set('ref', e.target.value)} />
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span>Due</span>
            <input value={f.due} placeholder="fri, +3, 2026-11-20" onChange={(e) => set('due', e.target.value)} />
            <em>{datePreview(f.due)}</em>
          </label>
          <label className="field">
            <span>Snooze until</span>
            <input value={f.snooze} placeholder="mon" onChange={(e) => set('snooze', e.target.value)} />
            <em>{datePreview(f.snooze)}</em>
          </label>
        </div>
        <div className="row">
          <label className="field">
            <span>Repeat</span>
            <input value={f.recur} placeholder="fri, weekday, mon,thu, month:1" onChange={(e) => set('recur', e.target.value)} />
          </label>
          <label className="field">
            <span>Waiting on</span>
            <input value={f.waiting} placeholder="who / what" onChange={(e) => set('waiting', e.target.value)} />
          </label>
        </div>
        <div className="field">
          <span>Description</span>
          <MarkdownEditor
            value={f.description}
            onChange={(v) => set('description', v)}
            onAttach={(a) => set('attachments', [...f.attachments, ...a])}
            rows={8}
          />
        </div>
        <div className="field">
          <span>
            Attachments{' '}
            <button type="button" onClick={() => fileRef.current?.click()}>
              add files…
            </button>
          </span>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={async (e) => {
              const atts = await uploadAll([...(e.target.files ?? [])], notify);
              set('attachments', [...f.attachments, ...atts]);
              e.target.value = '';
            }}
          />
          <AttachmentList
            items={f.attachments}
            onRemove={(file) => set('attachments', f.attachments.filter((a) => a.file !== file))}
          />
        </div>
        {errors.map((e) => (
          <div key={e} className="error">
            {e}
          </div>
        ))}
      </div>
    </Modal>
  );
}
