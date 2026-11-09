import { useMemo, useState } from 'react';
import { formatDuration, minutesBetween, parseDateTime, parseRange, prettyDay } from '../../shared/dates';
import type { TimeCorrection } from '../../shared/types';
import { newId } from '../../shared/types';
import { useStore } from '../store';
import { Modal } from './Modal';

const show = (dt: string) => `${prettyDay(dt)} ${dt.slice(11, 16)}`;

/**
 * From / To / Reason / optional task. "today 9-11:30" in From fills both ends.
 * Dates are relative to `baseDay` (the selected day in the week view, or today).
 */
export function TimeCorrectionForm({
  initial,
  baseDay,
  onSave,
  onClose,
}: {
  initial?: TimeCorrection;
  baseDay: string;
  onSave: (c: TimeCorrection) => void;
  onClose: () => void;
}) {
  const { doc, today } = useStore();
  const [from, setFrom] = useState(initial ? `${initial.from.slice(0, 10)} ${initial.from.slice(11)}` : '');
  const [to, setTo] = useState(initial ? `${initial.to.slice(0, 10)} ${initial.to.slice(11)}` : '');
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [task, setTask] = useState(initial?.task ?? '');

  // Bare times ("9:00") mean the selected day; words ("mon", "yesterday") are relative to today.
  const parseDT = (s: string) => (/^\d/.test(s.trim()) && !/^\d{4}-/.test(s.trim()) ? parseDateTime(s, baseDay) : parseDateTime(s, today));
  const range = parseRange(from, /^\d/.test(from.trim()) ? baseDay : today);
  const f = range?.from ?? parseDT(from);
  // "To" without a date takes the date of "From".
  const t = range?.to ?? (f && /^\d{1,2}([:h]\d{2})?$/.test(to.trim()) ? parseDateTime(to, f.slice(0, 10)) : parseDT(to));
  const mins = f && t ? minutesBetween(f, t) : 0;

  const errors: string[] = [];
  if (from.trim() && !f) errors.push('From: use e.g. "mon 9:00", "9:00", or a range "today 9-11:30"');
  if (!range && to.trim() && !t) errors.push('To: use e.g. "11:30" or "mon 11:30"');
  if (f && t && mins <= 0) errors.push('"To" must be after "From"');
  if (!reason.trim()) errors.push('Reason is required');
  const ok = f && t && mins > 0 && reason.trim();

  const tasks = useMemo(
    () => [...doc.tasks].sort((a, b) => Number(!!a.done) - Number(!!b.done) || b.created.localeCompare(a.created)).slice(0, 200),
    [doc.tasks],
  );

  function save() {
    if (!ok) return;
    onSave({
      id: initial?.id ?? newId(),
      from: f!,
      to: t!,
      reason: reason.trim(),
      task: task || null,
      submitted: initial?.submitted ?? false,
    });
    onClose();
  }

  return (
    <Modal
      title={initial ? 'Edit time correction' : 'New time correction'}
      onClose={onClose}
      onKey={(k) => {
        if (k === 'Enter' || k === 'ctrl+Enter' || k === 'ctrl+s') return save(), true;
      }}
      footer={
        <>
          <code>9:00</code> <code>mon 9:00</code> <code>yesterday 14h</code> or From = <code>today 9-11:30</code> · <kbd>⏎</kbd> save
        </>
      }
    >
      <div className="form">
        <label className="field">
          <span>From</span>
          <input value={from} placeholder={`9:00  (on ${prettyDay(baseDay)})`} onChange={(e) => setFrom(e.target.value)} />
          <em>{f ? show(f) : ''}</em>
        </label>
        <label className="field">
          <span>To</span>
          <input value={range ? '' : to} disabled={!!range} placeholder={range ? 'from the range' : '11:30'} onChange={(e) => setTo(e.target.value)} />
          <em>{t ? show(t) : ''}</em>
        </label>
        <label className="field">
          <span>Reason</span>
          <input value={reason} placeholder="Forgot to start the tracker: release meeting" onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="field">
          <span>Task</span>
          <select value={task} onChange={(e) => setTask(e.target.value)}>
            <option value="">(none)</option>
            {tasks.map((x) => (
              <option key={x.id} value={x.id}>
                {x.done ? '✓ ' : ''}
                {x.title}
              </option>
            ))}
          </select>
        </label>
        {mins > 0 && <div className="preview">Duration: {formatDuration(mins)}</div>}
        {(from || to || reason) && errors.map((e) => <div key={e} className="error">{e}</div>)}
      </div>
    </Modal>
  );
}
