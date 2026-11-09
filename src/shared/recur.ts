import { addDays, fromISODate, toISODate, weekdayIndex } from './dates';

/**
 * Recurrence rules:
 *   day            every day
 *   weekday        Monday to Friday
 *   mon,thu / fri  on those weekdays
 *   week           every 7 days
 *   month:15       on that day of the month (clamped to the month's last day)
 *   month          same day of month as the reference date
 */
export function isValidRecur(rule: string): boolean {
  return nextOccurrence(rule, '2026-01-01') !== null;
}

/** First date strictly after `after` that matches the rule. */
export function nextOccurrence(rule: string, after: string): string | null {
  const r = rule.trim().toLowerCase();
  if (r === 'day' || r === 'daily') return addDays(after, 1);
  if (r === 'week' || r === 'weekly') return addDays(after, 7);
  if (r === 'weekday' || r === 'weekdays') {
    let d = addDays(after, 1);
    while ([0, 6].includes(fromISODate(d).getDay())) d = addDays(d, 1);
    return d;
  }
  const mm = r.match(/^month(?:ly)?(?::(\d{1,2}))?$/);
  if (mm) {
    const a = fromISODate(after);
    const dom = mm[1] ? Number(mm[1]) : a.getDate();
    if (dom < 1 || dom > 31) return null;
    for (let i = 0; i < 2; i++) {
      const y = a.getFullYear();
      const m = a.getMonth() + i;
      const last = new Date(y, m + 1, 0).getDate();
      const cand = toISODate(new Date(y, m, Math.min(dom, last)));
      if (cand > after) return cand;
    }
    return null;
  }
  const days = r.split(/[,\s]+/).filter(Boolean).map(weekdayIndex);
  if (days.length && days.every((i) => i >= 0)) {
    let d = addDays(after, 1);
    for (let i = 0; i < 7; i++) {
      if (days.includes(fromISODate(d).getDay())) return d;
      d = addDays(d, 1);
    }
  }
  return null;
}
