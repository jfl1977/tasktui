// Pure task logic used by the client (and tests).
import { addDays, diffDays, minutesBetween } from './dates';
import { labelParts } from './parse';
import { nextOccurrence } from './recur';
import type { Doc, Task, TimeCorrection } from './types';
import { newId } from './types';

export type ViewId =
  | { kind: 'today' }
  | { kind: 'inbox' }
  | { kind: 'waiting' }
  | { kind: 'snoozed' }
  | { kind: 'done' }
  | { kind: 'all' }
  | { kind: 'labels'; labels: string[] } // AND
  | { kind: 'source'; source: string };

export function isSnoozed(t: Task, today: string): boolean {
  return !!t.snooze_until && t.snooze_until > today;
}

export function isOnToday(t: Task, today: string): boolean {
  if (t.done || isSnoozed(t, today)) return false;
  return (!!t.today && t.today <= today) || (!!t.due && t.due <= today);
}

export function matchesView(t: Task, v: ViewId, today: string): boolean {
  switch (v.kind) {
    case 'today':
      return isOnToday(t, today);
    case 'inbox':
      return !t.done && !isSnoozed(t, today);
    case 'waiting':
      return !t.done && !!t.waiting;
    case 'snoozed':
      return !t.done && isSnoozed(t, today);
    case 'done':
      return !!t.done;
    case 'all':
      return true;
    case 'labels':
      return !t.done && !isSnoozed(t, today) && v.labels.every((l) => t.labels.includes(l));
    case 'source':
      return !t.done && !isSnoozed(t, today) && t.source === v.source;
  }
}

export type SortMode = 'manual' | 'due' | 'newest';

export function sortTasks(tasks: Task[], mode: SortMode, view: ViewId): Task[] {
  const arr = [...tasks];
  if (view.kind === 'done') return arr.sort((a, b) => (b.done ?? '').localeCompare(a.done ?? ''));
  if (mode === 'newest') return arr.sort((a, b) => b.created.localeCompare(a.created));
  if (mode === 'due')
    return arr.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.order - b.order);
  const key = view.kind === 'today' ? 'today_order' : 'order';
  return arr.sort((a, b) => a[key] - b[key] || a.created.localeCompare(b.created));
}

/** Group key for a task: "" when the task has no label of that type. */
export function groupValue(t: Task, groupBy: string): string {
  if (groupBy === 'source') return t.source;
  const vals = t.labels.filter((l) => labelParts(l)[0] === groupBy).map((l) => labelParts(l)[1]);
  return vals.join(', ');
}

export function labelTypes(tasks: Task[]): string[] {
  const s = new Set<string>();
  for (const t of tasks) for (const l of t.labels) {
    const [type] = labelParts(l);
    if (type) s.add(type);
  }
  return [...s].sort();
}

export function minOrder(tasks: Task[], key: 'order' | 'today_order'): number {
  return tasks.reduce((m, t) => Math.min(m, t[key]), 0) - 1;
}

/**
 * Mark a task done on `date`. For recurring tasks, a fresh copy is created for the next
 * occurrence (due date set, attachments and done date cleared). Mutates `doc`.
 */
export function completeTask(doc: Doc, id: string, date: string): Task | null {
  const t = doc.tasks.find((x) => x.id === id);
  if (!t) return null;
  t.done = date;
  if (t.recur) {
    const base = t.due && t.due > date ? t.due : date;
    const next = nextOccurrence(t.recur, base);
    if (next) {
      const copy: Task = {
        ...structuredClone(t),
        id: newId(),
        done: null,
        due: next,
        today: null,
        snooze_until: null,
        waiting: null,
        attachments: [],
        created: t.created,
      };
      doc.tasks.push(copy);
      return copy;
    }
  }
  return null;
}

export function archiveCandidates(doc: Doc, today: string): Task[] {
  const cutoff = addDays(today, -doc.settings.archive_after_days);
  return doc.tasks.filter((t) => t.done && t.done < cutoff);
}

export function correctionMinutes(c: TimeCorrection): number {
  return minutesBetween(c.from, c.to);
}

export interface Summary {
  today: number;
  waiting: number;
  overdue: number;
  dueTomorrow: number;
  pendingCorrections: number;
  pendingMinutes: number;
}

export function summarize(doc: Doc, today: string): Summary {
  const open = doc.tasks.filter((t) => !t.done);
  const pending = doc.time_corrections.filter((c) => !c.submitted);
  return {
    today: open.filter((t) => isOnToday(t, today)).length,
    waiting: open.filter((t) => t.waiting).length,
    overdue: open.filter((t) => t.due && t.due < today).length,
    dueTomorrow: open.filter((t) => t.due === addDays(today, 1)).length,
    pendingCorrections: pending.length,
    pendingMinutes: pending.reduce((s, c) => s + correctionMinutes(c), 0),
  };
}

export function waitingDays(t: Task, today: string): number {
  return t.waiting ? diffDays(today, t.waiting.since) : 0;
}
