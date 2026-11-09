import uFuzzy from '@leeoniya/ufuzzy';
import { useMemo, useState } from 'react';
import { prettyDay } from '../../shared/dates';
import { isOnToday, isSnoozed } from '../../shared/logic';
import { normalizeLabel } from '../../shared/parse';
import type { Task } from '../../shared/types';
import { useStore } from '../store';
import { Modal } from './Modal';

export type SearchHit =
  | { kind: 'task'; task: Task; archived: boolean }
  | { kind: 'day'; date: string }
  | { kind: 'week'; week: string }
  | { kind: 'correction'; id: string; date: string };

interface Item {
  hit: SearchHit;
  title: string;
  sub: string;
  text: string; // what the fuzzy matcher sees
  task?: Task;
}

// Up to 2 missing letters per word: "exprt bg" → export bug, "relse" → release.
const uf = new uFuzzy({ intraMode: 0, intraIns: 2 });

function snippet(text: string, terms: string[]): string {
  const low = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    at = low.indexOf(t.toLowerCase());
    if (at >= 0) break;
  }
  const s = Math.max(0, at - 30);
  const clean = text.slice(s, s + 110).replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼').replace(/\s+/g, ' ');
  return (s > 0 ? '…' : '') + clean;
}

/**
 * Filters: #label (prefix match: "#project:" = any project), @source,
 * is:open|done|waiting|snoozed|today|archived. Everything else is fuzzy text.
 */
export function parseQuery(q: string, aliases: Record<string, string>) {
  const labels: string[] = [];
  const sources: string[] = [];
  const is: string[] = [];
  const words: string[] = [];
  for (const tok of q.trim().split(/\s+/).filter(Boolean)) {
    if (tok.startsWith('#') && tok.length > 1) labels.push(normalizeLabel(tok, aliases));
    else if (tok.startsWith('@') && tok.length > 1) sources.push(tok.slice(1).toLowerCase());
    else if (tok.toLowerCase().startsWith('is:')) is.push(tok.slice(3).toLowerCase());
    else words.push(tok);
  }
  return { labels, sources, is, text: words.join(' ') };
}

export function Search({ onPick, onClose }: { onPick: (h: SearchHit) => void; onClose: () => void }) {
  const { doc, archive, today } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const taskItem = (t: Task, archived: boolean): Item => ({
      hit: { kind: 'task', task: t, archived },
      task: t,
      title: t.title,
      sub: [t.done ? `✓ ${t.done}` : '', archived ? 'archived' : '', t.labels.map((l) => '#' + l).join(' '), t.source, t.ref]
        .filter(Boolean)
        .join(' · '),
      text: [t.title, t.labels.join(' '), t.ref, t.source, t.description, t.waiting?.on, t.attachments.map((a) => a.name).join(' ')]
        .filter(Boolean)
        .join(' '),
    });
    for (const t of doc.tasks) out.push(taskItem(t, false));
    for (const t of archive) out.push(taskItem(t, true));
    for (const [date, text] of Object.entries(doc.days))
      if (text.trim()) out.push({ hit: { kind: 'day', date }, title: `Day note · ${prettyDay(date)} ${date.slice(0, 4)}`, sub: '', text });
    for (const [week, text] of Object.entries(doc.weeks))
      if (text.trim()) out.push({ hit: { kind: 'week', week }, title: `Week note · ${week}`, sub: '', text });
    for (const c of doc.time_corrections)
      out.push({
        hit: { kind: 'correction', id: c.id, date: c.from.slice(0, 10) },
        title: `Time correction · ${prettyDay(c.from)} ${c.from.slice(11)}–${c.to.slice(11)}`,
        sub: c.reason,
        text: c.reason,
      });
    return out;
  }, [doc, archive]);

  const results = useMemo(() => {
    const p = parseQuery(q, doc.settings.label_aliases);
    const filtering = p.labels.length || p.sources.length || p.is.length;
    let pool = items;
    if (filtering) {
      pool = items.filter((it) => {
        const t = it.task;
        if (!t) return false;
        const archived = it.hit.kind === 'task' && it.hit.archived;
        if (!p.labels.every((l) => t.labels.some((x) => x === l || (l.endsWith(':') && x.startsWith(l))))) return false;
        if (p.sources.length && !p.sources.includes(t.source)) return false;
        return p.is.every((s) =>
          s === 'open' ? !t.done
          : s === 'done' ? !!t.done
          : s === 'waiting' ? !t.done && !!t.waiting
          : s === 'snoozed' ? !t.done && isSnoozed(t, today)
          : s === 'today' ? isOnToday(t, today)
          : s === 'archived' ? archived
          : true,
        );
      });
    }
    if (!p.text) {
      // No text: open tasks first when filtering, otherwise nothing to show yet.
      return filtering ? [...pool].sort((a, b) => Number(!!a.task?.done) - Number(!!b.task?.done)).slice(0, 100) : [];
    }
    const hay = pool.map((i) => i.text);
    const [idxs, info, order] = uf.search(hay, p.text, 1, 1e3);
    if (!idxs) return [];
    const ranked = order ? order.map((o) => pool[info!.idx[o]]) : idxs.map((i) => pool[i]);
    // Open tasks before done/archived ones at similar relevance.
    return ranked
      .map((it, rank) => ({ it, score: rank + (it.task?.done ? 5 : 0) }))
      .sort((a, b) => a.score - b.score)
      .map((x) => x.it)
      .slice(0, 100);
  }, [q, items, today, doc.settings.label_aliases]);

  const terms = parseQuery(q, {}).text.split(/\s+/).filter(Boolean);
  const cur = Math.min(sel, results.length - 1);

  return (
    <Modal
      title="Search"
      wide
      onClose={onClose}
      onKey={(k) => {
        if (k === 'ArrowDown' || k === 'ctrl+j' || k === 'ctrl+n') return setSel((s) => Math.min(s + 1, results.length - 1)), true;
        if (k === 'ArrowUp' || k === 'ctrl+k' || k === 'ctrl+p') return setSel((s) => Math.max(s - 1, 0)), true;
        if (k === 'Enter' && results[cur]) {
          onClose();
          onPick(results[cur].hit);
          return true;
        }
      }}
      footer={
        <>
          fuzzy text · <code>#project:apollo</code> <code>#req:</code> <code>@jira</code> <code>is:open</code> <code>is:done</code>{' '}
          <code>is:waiting</code> <code>is:archived</code> · <kbd>↑↓</kbd> <kbd>⏎</kbd> open
        </>
      }
    >
      <input className="capture" value={q} placeholder="Search everything…" onChange={(e) => (setQ(e.target.value), setSel(0))} />
      <div className="results">
        {results.map((r, i) => (
          <div
            key={i}
            className={`result ${i === cur ? 'sel' : ''} ${r.task?.done ? 'is-done' : ''}`}
            onMouseEnter={() => setSel(i)}
            onClick={() => (onClose(), onPick(r.hit))}
          >
            <div className="r-title">{r.title}</div>
            <div className="r-sub">
              {r.sub}
              {terms.length > 0 && r.text !== r.title && !r.title.toLowerCase().includes(terms[0].toLowerCase()) && (
                <span className="snippet"> {snippet(r.text, terms)}</span>
              )}
            </div>
          </div>
        ))}
        {q.trim() && !results.length && <div className="dim">No matches.</div>}
      </div>
    </Modal>
  );
}

