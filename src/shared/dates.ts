// Local-time date helpers. Dates are plain strings: YYYY-MM-DD and YYYY-MM-DDTHH:mm.

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toISODateTime(d: Date): string {
  return `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fromISODateTime(s: string): Date {
  const d = fromISODate(s);
  const [h, mi] = (s.slice(11, 16) || '00:00').split(':').map(Number);
  d.setHours(h, mi, 0, 0);
  return d;
}

export function addDays(iso: string, n: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((fromISODate(a).getTime() - fromISODate(b).getTime()) / 86400000);
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function weekdayIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return WEEKDAYS.indexOf(w as (typeof WEEKDAYS)[number]);
}

/**
 * Parse a user date. Accepts: today, tomorrow (tom), yesterday (yest), mon..sun (next one,
 * or "last mon"), +3 / -2 (days), 2026-11-20, 20/11, 20/11/2026.
 * Returns null when not understood.
 */
export function parseDate(input: string, today: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === 'today' || s === 'tod' || s === 'now') return today;
  if (s === 'tomorrow' || s === 'tom' || s === 'tmr') return addDays(today, 1);
  if (s === 'yesterday' || s === 'yest' || s === 'yday') return addDays(today, -1);
  let m = s.match(/^([+-])(\d{1,3})([dw]?)$/);
  if (m) {
    const n = Number(m[2]) * (m[3] === 'w' ? 7 : 1);
    return addDays(today, m[1] === '+' ? n : -n);
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/);
  if (m) {
    const t = fromISODate(today);
    let y = m[3] ? Number(m[3]) : t.getFullYear();
    if (y < 100) y += 2000;
    return valid(y, Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(last |next )?([a-z]{3,9})$/);
  if (m && isDayName(m[2])) {
    const idx = weekdayIndex(m[2]);
    const cur = fromISODate(today).getDay();
    if (m[1] === 'last ') return addDays(today, -((cur - idx + 7) % 7 || 7));
    return addDays(today, (idx - cur + 7) % 7 || 7);
  }
  return null;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function isDayName(w: string): boolean {
  return DAY_NAMES.some((d) => d.startsWith(w) && w.length >= 3);
}

function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return toISODate(dt);
}

/**
 * Parse a date-time: "<date> 9:30", "9:30" (today), "mon 14h", "2026-11-03 09:00".
 */
export function parseDateTime(input: string, today: string): string | null {
  const s = input.trim().toLowerCase();
  const m = s.match(/^(?:(.+?)\s+)?(\d{1,2})(?:[:h](\d{2})?)?$/);
  if (!m) return null;
  const date = m[1] ? parseDate(m[1], today) : today;
  if (!date) return null;
  const h = Number(m[2]);
  const mi = Number(m[3] ?? 0);
  if (h > 23 || mi > 59) return null;
  return `${date}T${pad(h)}:${pad(mi)}`;
}

/**
 * Parse a time range typed in one field: "today 9-11:30", "mon 9:00-11:30".
 * Returns null if it isn't a range.
 */
export function parseRange(input: string, today: string): { from: string; to: string } | null {
  const s = input.trim().toLowerCase();
  const m = s.match(/^(?:(.+?)\s+)?(\d{1,2}(?:[:h]\d{2})?h?)\s*-\s*(\d{1,2}(?:[:h]\d{2})?h?)$/);
  if (!m) return null;
  const prefix = m[1] ? m[1] + ' ' : '';
  const from = parseDateTime(prefix + m[2].replace(/h$/, ''), today);
  const to = parseDateTime(prefix + m[3].replace(/h$/, ''), today);
  if (!from || !to) return null;
  return { from, to };
}

export function minutesBetween(from: string, to: string): number {
  return Math.round((fromISODateTime(to).getTime() - fromISODateTime(from).getTime()) / 60000);
}

export function formatDuration(min: number): string {
  const sign = min < 0 ? '-' : '';
  const a = Math.abs(min);
  return `${sign}${Math.floor(a / 60)}h${pad(a % 60)}`;
}

// ISO week (weeks start Monday; week 1 contains the first Thursday).
export function isoWeek(iso: string): { year: number; week: number } {
  const d = fromISODate(iso);
  const day = (d.getDay() + 6) % 7; // mon=0
  d.setDate(d.getDate() - day + 3); // thursday of this week
  const year = d.getFullYear();
  const dayOfYear = Math.round((d.getTime() - new Date(year, 0, 1).getTime()) / 86400000);
  return { year, week: Math.floor(dayOfYear / 7) + 1 };
}

export function weekKey(iso: string): string {
  const { year, week } = isoWeek(iso);
  return `${year}-W${pad(week)}`;
}

export function mondayOf(iso: string): string {
  const day = (fromISODate(iso).getDay() + 6) % 7;
  return addDays(iso, -day);
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon Nov 3" */
export function prettyDay(iso: string): string {
  const d = fromISODate(iso);
  return `${DAYS_SHORT[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Short relative form for lists: "today", "tomorrow", "fri", "Nov 20". */
export function relDay(iso: string, today: string): string {
  const diff = diffDays(iso, today);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff > 1 && diff < 7) return DAYS_SHORT[fromISODate(iso).getDay()].toLowerCase();
  const d = fromISODate(iso);
  const t = fromISODate(today);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== t.getFullYear() ? ' ' + d.getFullYear() : ''}`;
}

export function hhmm(dt: string): string {
  return dt.slice(11, 16);
}
