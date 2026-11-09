import { parseDate } from './dates';
import { isValidRecur } from './recur';
import type { Task } from './types';

export const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/;

export interface Captured {
  title: string;
  labels: string[];
  source: string | null;
  ref: string;
  due: string | null;
  snooze_until: string | null;
  today: boolean;
  recur: string | null;
  errors: string[];
}

/** Normalize a label: lowercase, apply type aliases ("p:apollo" -> "project:apollo"). */
export function normalizeLabel(raw: string, aliases: Record<string, string>): string {
  const l = raw.replace(/^#/, '').trim().toLowerCase();
  const i = l.indexOf(':');
  if (i > 0) {
    const type = l.slice(0, i);
    return `${aliases[type] ?? type}:${l.slice(i + 1)}`;
  }
  return l;
}

/** Split "project:apollo" into ["project", "apollo"]; plain labels have type "". */
export function labelParts(label: string): [string, string] {
  const i = label.indexOf(':');
  return i > 0 ? [label.slice(0, i), label.slice(i + 1)] : ['', label];
}

/**
 * Parse a quick-capture line, e.g.
 *   Fix export bug #clientx #p:apollo @jira PROJ-123 ^fri ~mon * every:fri
 * Unrecognized tokens stay in the title. Invalid dates are reported in `errors`
 * and also left in the title so nothing typed is lost.
 */
export function parseCapture(line: string, today: string, aliases: Record<string, string> = {}): Captured {
  const out: Captured = {
    title: '',
    labels: [],
    source: null,
    ref: '',
    due: null,
    snooze_until: null,
    today: false,
    recur: null,
    errors: [],
  };
  const words: string[] = [];
  for (const tok of line.trim().split(/\s+/).filter(Boolean)) {
    if (tok.length > 1 && tok.startsWith('#')) {
      const l = normalizeLabel(tok, aliases);
      if (!out.labels.includes(l)) out.labels.push(l);
    } else if (tok.length > 1 && tok.startsWith('@')) {
      out.source = tok.slice(1).toLowerCase();
    } else if (tok.length > 1 && (tok.startsWith('^') || tok.startsWith('~'))) {
      const d = parseDate(tok.slice(1), today);
      if (!d) {
        out.errors.push(`Unknown date "${tok.slice(1)}"`);
        words.push(tok);
      } else if (tok.startsWith('^')) out.due = d;
      else out.snooze_until = d;
    } else if (tok === '*') {
      out.today = true;
    } else if (tok.toLowerCase().startsWith('every:')) {
      const rule = tok.slice(6).toLowerCase();
      if (isValidRecur(rule)) out.recur = rule;
      else {
        out.errors.push(`Unknown repeat rule "${rule}"`);
        words.push(tok);
      }
    } else if (JIRA_KEY.test(tok) && !out.ref) {
      out.ref = tok;
      if (!out.source) out.source = 'jira';
      words.push(tok); // keep the key readable in the title
    } else if (/^https?:\/\//i.test(tok) && !out.ref) {
      out.ref = tok;
    } else {
      words.push(tok);
    }
  }
  out.title = words.join(' ');
  return out;
}

/** Turn capture results into task fields. */
export function captureToTask(c: Captured, today: string): Partial<Task> {
  return {
    title: c.title,
    labels: c.labels,
    source: c.source ?? 'me',
    ref: c.ref,
    due: c.due,
    snooze_until: c.snooze_until,
    today: c.today ? today : null,
    recur: c.recur,
  };
}
