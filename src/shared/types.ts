// Data model. See docs/SPEC.md §8 for the file format.

export type ISODate = string; // YYYY-MM-DD (local)
export type ISODateTime = string; // YYYY-MM-DDTHH:mm (local)

export const SOURCES = ['me', 'email', 'teams', 'jira', 'meeting'] as const;
export type Source = string; // usually one of SOURCES, free values allowed

export interface Attachment {
  file: string; // stored name inside attachments/
  name: string; // original name
  added: ISODateTime;
}

export interface Task {
  id: string;
  title: string;
  description: string; // markdown
  labels: string[]; // "urgent" or "project:apollo"
  source: Source;
  ref: string; // Jira key, URL or free text
  created: ISODateTime;
  due: ISODate | null;
  snooze_until: ISODate | null;
  today: ISODate | null; // pinned to Today on that date (carries over until done/unpinned)
  waiting: { on: string; since: ISODate } | null;
  recur: string | null; // "day" | "weekday" | "mon,thu" | "month:1"
  done: ISODate | null;
  order: number;
  today_order: number;
  attachments: Attachment[];
}

export interface TimeCorrection {
  id: string;
  from: ISODateTime;
  to: ISODateTime;
  reason: string;
  task: string | null; // task id
  submitted: boolean;
}

export interface Settings {
  archive_after_days: number;
  waiting_nudge_days: number; // waiting this long = time to follow up
  backups_keep: number;
  jira_url: string;
  label_aliases: Record<string, string>; // "p" -> "project"
}

export interface Doc {
  version: 1;
  rev: number; // incremented by the server on every save
  settings: Settings;
  tasks: Task[];
  days: Record<ISODate, string>;
  weeks: Record<string, string>; // "2026-W45"
  time_corrections: TimeCorrection[];
}

export interface Archive {
  version: 1;
  tasks: Task[];
}

export const DEFAULT_SETTINGS: Settings = {
  archive_after_days: 30,
  waiting_nudge_days: 3,
  backups_keep: 14,
  jira_url: '',
  label_aliases: { p: 'project', m: 'module', r: 'req' },
};

export function emptyDoc(): Doc {
  return {
    version: 1,
    rev: 0,
    settings: { ...DEFAULT_SETTINGS },
    tasks: [],
    days: {},
    weeks: {},
    time_corrections: [],
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

export function newTask(partial: Partial<Task>, now: ISODateTime): Task {
  return {
    id: newId(),
    title: '',
    description: '',
    labels: [],
    source: 'me',
    ref: '',
    created: now,
    due: null,
    snooze_until: null,
    today: null,
    waiting: null,
    recur: null,
    done: null,
    order: 0,
    today_order: 0,
    attachments: [],
    ...partial,
  };
}

/** Fill in fields missing from older files so the rest of the code can rely on them. */
export function normalizeDoc(raw: Partial<Doc>): Doc {
  const d = emptyDoc();
  return {
    ...d,
    ...raw,
    version: 1,
    rev: raw.rev ?? 0,
    settings: { ...d.settings, ...(raw.settings ?? {}) },
    tasks: (raw.tasks ?? []).map((t) => newTask(t, t.created ?? '')),
    days: raw.days ?? {},
    weeks: raw.weeks ?? {},
    time_corrections: raw.time_corrections ?? [],
  };
}
