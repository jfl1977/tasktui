import { useEffect, useMemo, useRef, useState } from 'react';
import { diffDays, prettyDay, relDay } from '../../shared/dates';
import {
  groupValue,
  isOnToday,
  isSnoozed,
  labelTypes,
  matchesView,
  sortTasks,
  waitingDays,
  type SortMode,
  type ViewId,
} from '../../shared/logic';
import { labelParts } from '../../shared/parse';
import type { Task } from '../../shared/types';
import { useTaskActions } from '../actions';
import { filesFrom } from '../api';
import { useStore } from '../store';
import { useUI } from '../ui';
import { clamp, keyName, renderMarkdown, useKeys } from '../util';
import { AttachmentList, openAttachment } from './Attachments';
import { uploadAll } from './MarkdownEditor';

interface Entry {
  key: string;
  text: string;
  count?: number;
  header?: boolean;
  view?: ViewId;
  label?: string; // label entries can be multi-selected
}

const SORTS: SortMode[] = ['manual', 'due', 'newest'];
const SORT_TEXT: Record<SortMode, string> = { manual: 'my order', due: 'due date', newest: 'newest' };

function load<T>(k: string, def: T): T {
  try {
    const v = localStorage.getItem('tasktui.' + k);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}
function persist(k: string, v: unknown) {
  try {
    localStorage.setItem('tasktui.' + k, JSON.stringify(v));
  } catch {
    /* private mode etc. */
  }
}

export function TasksView({ active, jump }: { active: boolean; jump: { id: string; n: number } | null }) {
  const { doc, today, notify } = useStore();
  const { modalOpen, editing } = useUI();
  const act = useTaskActions();
  const [entryKey, setEntryKey] = useState<string>(() => load('entry', 'inbox'));
  const [checked, setChecked] = useState<string[]>(() => load('checked', []));
  const [pane, setPane] = useState<'list' | 'side'>('list');
  const [sideIdx, setSideIdx] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<string>(() => load('groupBy', ''));
  const [sort, setSort] = useState<SortMode>(() => load('sort', 'manual'));
  const [dragId, setDragId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => persist('entry', entryKey), [entryKey]);
  useEffect(() => persist('checked', checked), [checked]);
  useEffect(() => persist('groupBy', groupBy), [groupBy]);
  useEffect(() => persist('sort', sort), [sort]);

  // ── Sidebar ──────────────────────────────────────────────
  const entries = useMemo<Entry[]>(() => {
    const open = doc.tasks.filter((t) => !t.done && !isSnoozed(t, today));
    const n = (v: ViewId) => doc.tasks.filter((t) => matchesView(t, v, today)).length;
    const e: Entry[] = [
      { key: 'today', text: '★ Today', view: { kind: 'today' }, count: n({ kind: 'today' }) },
      { key: 'inbox', text: '▢ Inbox', view: { kind: 'inbox' }, count: n({ kind: 'inbox' }) },
      { key: 'waiting', text: '⏳ Waiting', view: { kind: 'waiting' }, count: n({ kind: 'waiting' }) },
      { key: 'snoozed', text: '💤 Snoozed', view: { kind: 'snoozed' }, count: n({ kind: 'snoozed' }) },
      { key: 'done', text: '✓ Done', view: { kind: 'done' } },
      { key: 'all', text: '∗ Everything', view: { kind: 'all' } },
    ];
    const counts = new Map<string, number>();
    for (const t of open) for (const l of t.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
    // Labels from done tasks stay listed (count 0) so filters don't vanish.
    for (const t of doc.tasks) for (const l of t.labels) if (!counts.has(l)) counts.set(l, 0);
    const byType = new Map<string, string[]>();
    for (const l of counts.keys()) {
      const [type] = labelParts(l);
      byType.set(type, [...(byType.get(type) ?? []), l]);
    }
    const types = [...byType.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    for (const type of types) {
      e.push({ key: 'h:' + type, text: type || 'labels', header: true });
      for (const l of byType.get(type)!.sort())
        e.push({ key: 'l:' + l, text: '#' + labelParts(l)[1], label: l, count: counts.get(l), view: { kind: 'labels', labels: [l] } });
    }
    const sources = new Map<string, number>();
    for (const t of open) sources.set(t.source, (sources.get(t.source) ?? 0) + 1);
    if (sources.size) {
      e.push({ key: 'h:source', text: 'source', header: true });
      for (const [s, c] of [...sources.entries()].sort())
        e.push({ key: 's:' + s, text: '@' + s, count: c, view: { kind: 'source', source: s } });
    }
    return e;
  }, [doc.tasks, today]);

  const view: ViewId = checked.length
    ? { kind: 'labels', labels: checked }
    : (entries.find((e) => e.key === entryKey)?.view ?? { kind: 'inbox' });
  const orderKey = view.kind === 'today' ? 'today_order' : 'order';

  // ── Task list ────────────────────────────────────────────
  const groupOptions = useMemo(() => ['', ...labelTypes(doc.tasks), 'source'], [doc.tasks]);
  const { rows, visible } = useMemo(() => {
    const list = sortTasks(
      doc.tasks.filter((t) => matchesView(t, view, today)),
      sort,
      view,
    );
    if (!groupBy) return { rows: list.map((t) => ({ task: t })), visible: list };
    const groups = new Map<string, Task[]>();
    for (const t of list) {
      const g = groupValue(t, groupBy);
      groups.set(g, [...(groups.get(g) ?? []), t]);
    }
    const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    const rows: ({ task: Task } | { group: string; count: number })[] = [];
    const visible: Task[] = [];
    for (const k of keys) {
      rows.push({ group: k || `(no ${groupBy})`, count: groups.get(k)!.length });
      for (const t of groups.get(k)!) rows.push({ task: t }), visible.push(t);
    }
    return { rows, visible };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.tasks, JSON.stringify(view), sort, groupBy, today]);

  // Keep a valid selection. When the selected task leaves the list (done, snoozed), select its neighbour.
  const lastIdx = useRef(0);
  let idx = visible.findIndex((t) => t.id === selId);
  if (idx < 0) idx = clamp(lastIdx.current, 0, visible.length - 1);
  const sel: Task | undefined = visible[idx];
  useEffect(() => {
    lastIdx.current = Math.max(idx, 0);
    if (sel && sel.id !== selId) setSelId(sel.id);
  });

  useEffect(() => {
    listRef.current?.querySelector('.task.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel?.id, active]);

  // Search jump: show a view that contains the task and select it.
  useEffect(() => {
    if (!jump) return;
    const t = doc.tasks.find((x) => x.id === jump.id);
    if (!t) return;
    setChecked([]);
    setEntryKey(t.done ? 'done' : isSnoozed(t, today) ? 'snoozed' : 'inbox');
    setSelId(t.id);
    setPane('list');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  function selectEntry(e: Entry) {
    if (e.header) return;
    setChecked([]);
    setEntryKey(e.key);
  }

  function toggleLabel(l: string) {
    const base = checked.length ? checked : entryKey.startsWith('l:') ? [entryKey.slice(2)] : [];
    const next = base.includes(l) ? base.filter((x) => x !== l) : [...base, l];
    setChecked(next);
    if (!next.length) setEntryKey('inbox');
  }

  const suffix = () => {
    if (view.kind === 'today') return '*';
    if (view.kind === 'labels') return view.labels.map((l) => '#' + l).join(' ');
    if (view.kind === 'source') return '@' + view.source;
    return '';
  };

  const attachToSelected = async (files: File[], target = sel) => {
    if (!files.length) return;
    if (!target) return notify('Select a task first to attach files', 'error');
    act.attach(target.id, await uploadAll(files, notify));
  };

  // Ctrl+V of screenshots / copied files attaches them to the selected task.
  useEffect(() => {
    if (!active || modalOpen) return;
    const onPaste = (e: ClipboardEvent) => {
      if (editing) return;
      const files = filesFrom(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        void attachToSelected(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const flows = act.flows;
  useKeys(active && !modalOpen && !editing, (e) => {
    const k = keyName(e);
    const handled = () => e.preventDefault();

    if (k === 'Tab' || k === 'shift+Tab') {
      handled();
      setPane((p) => (p === 'list' ? 'side' : 'list'));
      if (pane === 'list') setSideIdx(Math.max(0, entries.findIndex((x) => x.key === entryKey)));
      return;
    }
    if (pane === 'side') {
      const step = (d: number) => {
        let i = sideIdx;
        do i = clamp(i + d, 0, entries.length - 1);
        while (entries[i].header && i > 0 && i < entries.length - 1);
        setSideIdx(i);
      };
      if (k === 'j' || k === 'ArrowDown') return handled(), step(1);
      if (k === 'k' || k === 'ArrowUp') return handled(), step(-1);
      const e2 = entries[sideIdx];
      if (k === 'space' && e2?.label) return handled(), toggleLabel(e2.label);
      if (k === 'Enter' || k === 'l' || k === 'ArrowRight') {
        handled();
        if (e2) selectEntry(e2);
        setPane('list');
        return;
      }
    }

    if (k === 'a') return handled(), flows.quickAdd(suffix(), (id) => setSelId(id));
    if (k === 'g') {
      handled();
      const next = groupOptions[(groupOptions.indexOf(groupBy) + 1) % groupOptions.length];
      setGroupBy(next);
      return notify(next ? `Grouped by ${next}` : 'No grouping');
    }
    if (k === 'S') {
      handled();
      const next = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length];
      setSort(next);
      return notify(`Sorted by ${SORT_TEXT[next]}`);
    }
    if (pane !== 'list') return;
    const go = (i: number) => visible[clamp(i, 0, visible.length - 1)] && setSelId(visible[clamp(i, 0, visible.length - 1)].id);
    if (k === 'j' || k === 'ArrowDown') return handled(), go(idx + 1);
    if (k === 'k' || k === 'ArrowUp') return handled(), go(idx - 1);
    if (k === 'Home') return handled(), go(0);
    if (k === 'End') return handled(), go(visible.length - 1);
    if (k === 'PageDown') return handled(), go(idx + 10);
    if (k === 'PageUp') return handled(), go(idx - 10);
    if (!sel) return;
    if (k === 'Enter') return handled(), flows.done(sel);
    if (k === 'e') return handled(), flows.edit(sel);
    if (k === '*') return handled(), act.togglePin(sel);
    if (k === 'w') return handled(), flows.waiting(sel);
    if (k === 's') return handled(), flows.snooze(sel);
    if (k === 'o') return handled(), flows.open(sel);
    if (k === 'f') return handled(), fileRef.current?.click();
    if (k === 'd' || k === 'Delete') return handled(), flows.remove(sel);
    if (k === 'alt+ArrowUp' || k === 'alt+ArrowDown' || k === 'K' || k === 'J') {
      handled();
      if (sort !== 'manual' || view.kind === 'done') return notify('Switch to "my order" (S) to reorder', 'error');
      if (groupBy) return notify('Turn off grouping (g) to reorder', 'error');
      return act.move(sel, visible, k === 'alt+ArrowUp' || k === 'K' ? -1 : 1, orderKey);
    }
  });

  const viewTitle = checked.length
    ? checked.map((l) => '#' + l).join(' + ')
    : (entries.find((e) => e.key === entryKey)?.text ?? 'Inbox');

  return (
    <div
      className="tasks-view"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        const files = filesFrom(e.dataTransfer);
        if (files.length) {
          e.preventDefault();
          void attachToSelected(files);
        }
      }}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void attachToSelected([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <nav className={`sidebar ${pane === 'side' ? 'focus' : ''}`}>
        {entries.map((e, i) => {
          const on = checked.length ? !!e.label && checked.includes(e.label) : e.key === entryKey;
          return e.header ? (
            <div key={e.key} className="side-header">
              ── {e.text} ──
            </div>
          ) : (
            <div
              key={e.key}
              className={`side-item ${on ? 'on' : ''} ${pane === 'side' && i === sideIdx ? 'cursor' : ''}`}
              onClick={(ev) => (ev.ctrlKey && e.label ? toggleLabel(e.label) : selectEntry(e))}
              title={e.label ? 'Click to show · Ctrl+click or space to combine labels' : undefined}
            >
              {e.label && checked.length > 0 && <span className="check">{on ? '☑' : '☐'} </span>}
              <span className="side-text">{e.text}</span>
              {e.count !== undefined && <span className="count">{e.count}</span>}
            </div>
          );
        })}
      </nav>

      <section className={`list-pane ${pane === 'list' ? 'focus' : ''}`}>
        <div className="list-header">
          <strong>{viewTitle}</strong>
          <span className="dim">
            {' '}
            {visible.length} · {SORT_TEXT[sort]}
            {groupBy && ` · by ${groupBy}`}
          </span>
        </div>
        <div className="task-list" ref={listRef}>
          {rows.map((r, i) =>
            'group' in r ? (
              <div key={'g' + i} className="group-row">
                ▾ {r.group} <span className="dim">({r.count})</span>
              </div>
            ) : (
              <TaskRow
                key={r.task.id}
                task={r.task}
                today={today}
                selected={r.task.id === sel?.id}
                showToday={view.kind !== 'today'}
                onClick={() => (setSelId(r.task.id), setPane('list'))}
                onDoubleClick={() => flows.edit(r.task)}
                draggable={sort === 'manual' && !groupBy && view.kind !== 'done'}
                dragging={dragId === r.task.id}
                onDragStart={() => setDragId(r.task.id)}
                onDragEnd={() => setDragId(null)}
                onDropRow={(files) => {
                  if (files.length) return void attachToSelected(files, r.task);
                  const t = visible.find((x) => x.id === dragId);
                  if (t) act.moveTo(t, r.task, visible, orderKey);
                  setDragId(null);
                }}
              />
            ),
          )}
          {!visible.length && (
            <div className="empty">
              {view.kind === 'today'
                ? 'Nothing for today. Pin tasks with * or give them a due date.'
                : 'No tasks here. Press a to add one.'}
            </div>
          )}
        </div>
      </section>

      <aside className="details">{sel ? <TaskDetails task={sel} /> : <div className="dim">No task selected</div>}</aside>
    </div>
  );
}

function TaskRow({
  task: t,
  today,
  selected,
  showToday,
  onClick,
  onDoubleClick,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
  onDropRow,
}: {
  task: Task;
  today: string;
  selected: boolean;
  showToday: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropRow: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  const overdue = !t.done && t.due && t.due < today;
  return (
    <div
      className={`task ${selected ? 'sel' : ''} ${t.done ? 'is-done' : ''} ${dragging ? 'dragging' : ''} ${over ? 'drop' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-task', t.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onDropRow(filesFrom(e.dataTransfer));
      }}
    >
      <span className="status">{t.done ? '✓' : t.waiting ? '⏳' : '☐'}</span>
      {showToday && isOnToday(t, today) && t.today && <span className="star">★</span>}
      <span className="title">{t.title}</span>
      {t.labels.map((l) => {
        const [type, value] = labelParts(l);
        return (
          <span key={l} className="label">
            #{type && <span className="ltype">{type}:</span>}
            {value}
          </span>
        );
      })}
      <span className="meta">
        {t.waiting && <span className="waiting">{t.waiting.on} {waitingDays(t, today)}d</span>}
        {t.ref && <span className="ref">{t.ref.length > 24 ? t.ref.slice(0, 22) + '…' : t.ref}</span>}
        {t.source !== 'me' && !(t.source === 'jira' && /^[A-Z]/.test(t.ref)) && <span className="source">@{t.source}</span>}
        {t.recur && <span title={`repeats ${t.recur}`}>↻</span>}
        {t.snooze_until && t.snooze_until > today && <span>💤 {relDay(t.snooze_until, today)}</span>}
        {t.due && !t.done && <span className={overdue ? 'overdue' : t.due === today ? 'due-today' : ''}>^{relDay(t.due, today)}</span>}
        {t.done && <span>{relDay(t.done, today)}</span>}
        {t.attachments.length > 0 && <span>📎{t.attachments.length}</span>}
      </span>
    </div>
  );
}

export function TaskDetails({ task: t }: { task: Task }) {
  const { today, doc, notify } = useStore();
  const linked = doc.time_corrections.filter((c) => c.task === t.id);
  return (
    <div className="task-details">
      <h2>{t.title}</h2>
      <dl>
        {t.labels.length > 0 && (
          <>
            <dt>labels</dt>
            <dd>{t.labels.map((l) => '#' + l).join(' ')}</dd>
          </>
        )}
        <dt>source</dt>
        <dd>
          {t.source}
          {t.ref && <> · {t.ref}</>}
        </dd>
        {t.due && (
          <>
            <dt>due</dt>
            <dd>
              {prettyDay(t.due)} ({relDay(t.due, today)})
            </dd>
          </>
        )}
        {t.waiting && (
          <>
            <dt>waiting</dt>
            <dd>
              on {t.waiting.on} since {prettyDay(t.waiting.since)} ({diffDays(today, t.waiting.since)}d)
            </dd>
          </>
        )}
        {t.snooze_until && t.snooze_until > today && (
          <>
            <dt>snoozed</dt>
            <dd>until {prettyDay(t.snooze_until)}</dd>
          </>
        )}
        {t.recur && (
          <>
            <dt>repeats</dt>
            <dd>{t.recur}</dd>
          </>
        )}
        {t.done && (
          <>
            <dt>done</dt>
            <dd>{prettyDay(t.done)}</dd>
          </>
        )}
        <dt>created</dt>
        <dd>{prettyDay(t.created.slice(0, 10))}</dd>
        {linked.length > 0 && (
          <>
            <dt>time</dt>
            <dd>{linked.length} correction(s)</dd>
          </>
        )}
      </dl>
      {t.description && <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.description) }} />}
      <h3>Attachments</h3>
      <AttachmentList items={t.attachments} onOpen={(a) => openAttachment(a, notify)} />
    </div>
  );
}
