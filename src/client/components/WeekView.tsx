import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, hhmm, mondayOf, prettyDay } from '../../shared/dates';
import { correctionMinutes, labelTypes } from '../../shared/logic';
import type { TimeCorrection } from '../../shared/types';
import { useStore } from '../store';
import { useUI } from '../ui';
import { clamp, copyRich, download, keyName, renderMarkdown, useKeys } from '../util';
import { inlineImages, nextMonday, weekData, weekMarkdown, weekTitle } from '../weekReport';
import { Confirm } from './Modal';
import { NoteEditor } from './NoteEditor';
import { TimeCorrectionForm } from './TimeCorrectionForm';

type Row = { kind: 'week' } | { kind: 'day'; date: string } | { kind: 'corr'; c: TimeCorrection };

export function WeekView({
  active,
  jump,
}: {
  active: boolean;
  jump: { date?: string; correction?: string; n: number } | null;
}) {
  const { doc, archive, today, update, notify } = useStore();
  const { openModal, modalOpen, editing } = useUI();
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [cursor, setCursor] = useState(1 + ((new Date().getDay() + 6) % 7)); // today's row
  const [groupBy, setGroupBy] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const w = useMemo(() => weekData(doc, archive, monday), [doc, archive, monday]);
  const rows: Row[] = [{ kind: 'week' }, ...w.days.map((d) => ({ kind: 'day' as const, date: d })), ...w.corrections.map((c) => ({ kind: 'corr' as const, c }))];
  const cur = clamp(cursor, 0, rows.length - 1);
  const row = rows[cur];
  const groupOptions = useMemo(() => ['', ...labelTypes([...doc.tasks, ...archive]), 'source'], [doc.tasks, archive]);

  useEffect(() => {
    if (!jump) return;
    if (jump.date) {
      const m = mondayOf(jump.date);
      setMonday(m);
      const wd = weekData(doc, archive, m);
      const i = jump.correction ? wd.corrections.findIndex((c) => c.id === jump.correction) : -1;
      setCursor(i >= 0 ? 8 + i : 1 + wd.days.indexOf(jump.date));
    } else setCursor(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  useEffect(() => {
    ref.current?.querySelector('.cursor')?.scrollIntoView({ block: 'nearest' });
  }, [cur, monday]);

  const editWeek = () =>
    openModal((close) => (
      <NoteEditor
        title={`Week note · ${weekTitle(w)}`}
        initial={doc.weeks[w.key] ?? ''}
        onClose={close}
        onSave={(text) => update('edit week note', (d) => void (text.trim() ? (d.weeks[w.key] = text) : delete d.weeks[w.key]))}
      />
    ));
  const editDay = (date: string) =>
    openModal((close) => (
      <NoteEditor
        title={`Day note · ${prettyDay(date)}`}
        initial={doc.days[date] ?? ''}
        onClose={close}
        onSave={(text) => update('edit day note', (d) => void (text.trim() ? (d.days[date] = text) : delete d.days[date]))}
      />
    ));
  const editCorrection = (c?: TimeCorrection) => {
    const base = row.kind === 'day' ? row.date : row.kind === 'corr' ? row.c.from.slice(0, 10) : w.days.includes(today) ? today : monday;
    openModal((close) => (
      <TimeCorrectionForm
        initial={c}
        baseDay={base}
        onClose={close}
        onSave={(nc) => {
          update(c ? 'edit time correction' : 'add time correction', (d) => {
            const i = d.time_corrections.findIndex((x) => x.id === nc.id);
            if (i >= 0) d.time_corrections[i] = nc;
            else d.time_corrections.push(nc);
          });
          const m = mondayOf(nc.from.slice(0, 10));
          if (m !== monday) setMonday(m);
          notify(`Time correction ${c ? 'saved' : 'added'}: ${formatDuration(correctionMinutes(nc))}`);
        }}
      />
    ));
  };

  async function copy() {
    const md = weekMarkdown(doc, w, groupBy);
    const html = await inlineImages(renderMarkdown(md));
    await copyRich(html, md);
    notify('Week copied: paste it in Teams, Outlook or anywhere');
  }

  useKeys(active && !modalOpen && !editing, (e) => {
    const k = keyName(e);
    const h = () => e.preventDefault();
    if (k === 'h' || k === 'ArrowLeft') return h(), setMonday((m) => nextMonday(m, -1));
    if (k === 'l' || k === 'ArrowRight') return h(), setMonday((m) => nextMonday(m, 1));
    if (k === '.' || k === 'T') return h(), setMonday(mondayOf(today)), setCursor(1 + ((new Date().getDay() + 6) % 7));
    if (k === 'j' || k === 'ArrowDown') return h(), setCursor(clamp(cur + 1, 0, rows.length - 1));
    if (k === 'k' || k === 'ArrowUp') return h(), setCursor(clamp(cur - 1, 0, rows.length - 1));
    if (k === 'e') return h(), editWeek();
    if (k === 'n' && row.kind === 'day') return h(), editDay(row.date);
    if (k === 'Enter') {
      h();
      if (row.kind === 'week') return editWeek();
      if (row.kind === 'day') return editDay(row.date);
      return editCorrection(row.c);
    }
    if (k === 't') return h(), editCorrection();
    if (k === 'c') return h(), void copy();
    if (k === 'x') {
      h();
      download(`week-${w.key}.md`, weekMarkdown(doc, w, groupBy).replace(/\]\(\/attachments\//g, `](${location.origin}/attachments/`));
      return notify(`Saved week-${w.key}.md to your Downloads`);
    }
    if (k === 'g') {
      h();
      const next = groupOptions[(groupOptions.indexOf(groupBy) + 1) % groupOptions.length];
      setGroupBy(next);
      return notify(next ? `Done tasks grouped by ${next}` : 'Grouped by day');
    }
    if (row.kind === 'corr') {
      if (k === 'space') {
        h();
        update(row.c.submitted ? 'unmark submitted' : 'mark submitted', (d) => {
          const c = d.time_corrections.find((x) => x.id === row.c.id)!;
          c.submitted = !c.submitted;
        });
        return;
      }
      if (k === 'd' || k === 'Delete') {
        h();
        const c = row.c;
        return openModal((close) => (
          <Confirm
            text={<>Delete the time correction “{c.reason}”?</>}
            onClose={close}
            onYes={() => update('delete time correction', (d) => void (d.time_corrections = d.time_corrections.filter((x) => x.id !== c.id)))}
          />
        ));
      }
    }
  });

  const grouped = useMemo(() => {
    if (!groupBy) return null;
    return renderMarkdown(weekMarkdown({ ...doc, weeks: {}, days: {}, time_corrections: [] }, w, groupBy).replace(/^# .*\n/, ''));
  }, [doc, w, groupBy]);

  let i = 0;
  return (
    <div className="week-view" ref={ref}>
      <div className="week-header">
        <span className="dim">‹ h</span>
        <strong>{weekTitle(w)}</strong>
        <span className="dim">l ›</span>
        {w.days.includes(today) ? <span className="chip">this week</span> : <span className="dim"> · . = this week</span>}
        {groupBy && <span className="chip">done by {groupBy}</span>}
      </div>

      <section className={`week-block ${cur === i++ ? 'cursor' : ''}`} onClick={() => setCursor(0)} onDoubleClick={editWeek}>
        <div className="block-title">
          Week notes <span className="dim">· e to edit</span>
        </div>
        {doc.weeks[w.key]?.trim() ? (
          <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.weeks[w.key]) }} />
        ) : (
          <div className="dim">Nothing yet. Press e to write highlights, blockers, plans…</div>
        )}
      </section>

      {grouped && <section className="week-block markdown grouped" dangerouslySetInnerHTML={{ __html: grouped }} />}

      {w.days.map((d) => {
        const idx = i++;
        const list = w.done.get(d)!;
        const note = doc.days[d];
        const weekend = idx >= 6;
        return (
          <section
            key={d}
            className={`week-block day ${cur === idx ? 'cursor' : ''} ${d === today ? 'is-today' : ''} ${weekend && !note && !list.length ? 'quiet' : ''}`}
            onClick={() => setCursor(idx)}
            onDoubleClick={() => editDay(d)}
          >
            <div className="block-title">
              {prettyDay(d)} {d === today && <span className="chip">today</span>}
            </div>
            {note?.trim() && <div className="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(note) }} />}
            {!groupBy &&
              list.map((t) => (
                <div key={t.id} className="done-line">
                  ✓ {t.title} {t.labels.map((l) => <span key={l} className="label">#{l}</span>)}
                </div>
              ))}
            {groupBy && list.length > 0 && <div className="dim">{list.length} done</div>}
          </section>
        );
      })}

      <section className="week-block">
        <div className="block-title">
          Time corrections <span className="dim">· t add · space entered in tracker · ⏎ edit · d delete</span>
        </div>
        {w.corrections.map((c) => {
          const idx = i++;
          const task = c.task ? doc.tasks.find((t) => t.id === c.task) ?? archive.find((t) => t.id === c.task) : null;
          return (
            <div key={c.id} className={`corr ${cur === idx ? 'cursor' : ''}`} onClick={() => setCursor(idx)} onDoubleClick={() => editCorrection(c)}>
              <span className="box">{c.submitted ? '☑' : '☐'}</span>
              <span className="when">
                {prettyDay(c.from).slice(0, 3)} {hhmm(c.from)}–{hhmm(c.to)}
              </span>
              <span className="dur">{formatDuration(correctionMinutes(c))}</span>
              <span className="reason">
                {c.reason}
                {task && <span className="dim"> · {task.title}</span>}
              </span>
            </div>
          );
        })}
        {w.corrections.length ? (
          <div className="corr-total">
            Total {formatDuration(w.totalMin)}
            {w.pendingMin > 0 && <span className="overdue"> · {formatDuration(w.pendingMin)} not entered yet</span>}
          </div>
        ) : (
          <div className="dim">None this week.</div>
        )}
      </section>
    </div>
  );
}
