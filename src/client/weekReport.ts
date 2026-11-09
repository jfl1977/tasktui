import { addDays, formatDuration, fromISODate, hhmm, prettyDay, weekDays, weekKey } from '../shared/dates';
import { correctionMinutes, groupValue } from '../shared/logic';
import type { Doc, Task, TimeCorrection } from '../shared/types';

export interface WeekData {
  monday: string;
  key: string;
  days: string[];
  done: Map<string, Task[]>; // by day
  corrections: TimeCorrection[];
  totalMin: number;
  pendingMin: number;
}

export function weekData(doc: Doc, archive: Task[], monday: string): WeekData {
  const days = weekDays(monday);
  const sunday = days[6];
  const done = new Map<string, Task[]>(days.map((d) => [d, []]));
  for (const t of [...doc.tasks, ...archive]) if (t.done && t.done >= monday && t.done <= sunday) done.get(t.done)!.push(t);
  for (const list of done.values()) list.sort((a, b) => a.title.localeCompare(b.title));
  const corrections = doc.time_corrections
    .filter((c) => c.from.slice(0, 10) >= monday && c.from.slice(0, 10) <= sunday)
    .sort((a, b) => a.from.localeCompare(b.from));
  const totalMin = corrections.reduce((s, c) => s + correctionMinutes(c), 0);
  const pendingMin = corrections.filter((c) => !c.submitted).reduce((s, c) => s + correctionMinutes(c), 0);
  return { monday, key: weekKey(monday), days, done, corrections, totalMin, pendingMin };
}

export function weekTitle(w: WeekData): string {
  const year = fromISODate(w.days[6]).getFullYear();
  return `Week ${Number(w.key.slice(6))} · ${prettyDay(w.monday).slice(4)} – ${prettyDay(w.days[6]).slice(4)} ${year}`;
}

const taskLine = (t: Task, showDay = false) => {
  const extra = [t.ref, ...t.labels.map((l) => '#' + l)].filter(Boolean).join(', ');
  return `- ✓ ${t.title}${extra ? ` (${extra})` : ''}${showDay && t.done ? ` · ${prettyDay(t.done).slice(0, 3)}` : ''}`;
};

/** Markdown summary of a week. `groupBy` = "" (by day) or a label type / "source". */
export function weekMarkdown(doc: Doc, w: WeekData, groupBy: string): string {
  const out: string[] = [`# ${weekTitle(w)}`, ''];
  const weekNote = doc.weeks[w.key]?.trim();
  if (weekNote) out.push(weekNote, '');

  if (groupBy) {
    const all = w.days.flatMap((d) => w.done.get(d)!);
    if (all.length) {
      out.push(`## Done by ${groupBy}`, '');
      const groups = new Map<string, Task[]>();
      for (const t of all) {
        const g = groupValue(t, groupBy) || `(no ${groupBy})`;
        groups.set(g, [...(groups.get(g) ?? []), t]);
      }
      for (const [g, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        out.push(`### ${g}`, ...list.map((t) => taskLine(t, true)), '');
      }
    }
    const notes = w.days.filter((d) => doc.days[d]?.trim());
    if (notes.length) {
      out.push('## Notes', '');
      for (const d of notes) out.push(`### ${prettyDay(d)}`, doc.days[d].trim(), '');
    }
  } else {
    for (const d of w.days) {
      const note = doc.days[d]?.trim();
      const list = w.done.get(d)!;
      if (!note && !list.length) continue;
      out.push(`## ${prettyDay(d)}`, '');
      if (note) out.push(note, '');
      if (list.length) out.push(...list.map((t) => taskLine(t)), '');
    }
  }

  if (w.corrections.length) {
    out.push('## Time corrections', '', '| Day | Time | Duration | Reason | Entered |', '|---|---|---|---|---|');
    for (const c of w.corrections)
      out.push(
        `| ${prettyDay(c.from)} | ${hhmm(c.from)}–${hhmm(c.to)} | ${formatDuration(correctionMinutes(c))} | ${c.reason.replace(/\|/g, '/')} | ${c.submitted ? '✓' : ''} |`,
      );
    out.push('', `**Total ${formatDuration(w.totalMin)}**${w.pendingMin ? ` (not entered yet: ${formatDuration(w.pendingMin)})` : ''}`, '');
  }
  return out.join('\n').trim() + '\n';
}

export const nextMonday = (monday: string, n: number) => addDays(monday, 7 * n);

/** Inline images as data URIs so they survive pasting into Outlook/Teams. */
export async function inlineImages(html: string): Promise<string> {
  const srcs = [...new Set([...html.matchAll(/src="(\/attachments\/[^"]+)"/g)].map((m) => m[1]))];
  for (const src of srcs) {
    try {
      const blob = await (await fetch(src)).blob();
      const data = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.readAsDataURL(blob);
      });
      html = html.split(`src="${src}"`).join(`src="${data}" style="max-width:600px"`);
    } catch {
      /* leave the link as is */
    }
  }
  return html;
}
