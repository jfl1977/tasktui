import { parseDate, relDay, toISODateTime } from '../shared/dates';
import { addText, completeTask } from '../shared/logic';
import { normalizeLabel } from '../shared/parse';
import type { Attachment, Doc, Task } from '../shared/types';
import { openAttachment } from './components/Attachments';
import { DonePrompt } from './components/DonePrompt';
import { EditTask } from './components/EditTask';
import { Confirm, Modal, Prompt } from './components/Modal';
import { QuickAdd } from './components/QuickAdd';
import { useStore } from './store';
import { useUI } from './ui';
import { jiraUrl } from './util';

const find = (d: Doc, id: string) => d.tasks.find((t) => t.id === id);

export function parseRelabel(v: string, aliases: Record<string, string>) {
  const add: string[] = [];
  const remove: string[] = [];
  for (const tok of v.trim().split(/[\s,]+/).filter(Boolean)) {
    const m = tok.match(/^([+-]?)#?(.+)$/);
    if (!m || (!tok.includes('#') && !m[1])) continue;
    (m[1] === '-' ? remove : add).push(normalizeLabel(m[2], aliases));
  }
  return { add, remove };
}

/** Task operations plus the dialogs that drive them. Shared by the views and search. */
export function useTaskActions() {
  const { doc, today, update, notify } = useStore();
  const { openModal } = useUI();

  const actions = {
    /** Add one task per line (bulk add). One undo step removes them all. Returns the first id. */
    add(text: string): string {
      let added: Task[] = [];
      update('add', (d) => {
        added = addText(d, text, today, toISODateTime(new Date()));
      });
      notify(added.length === 1 ? `Added "${added[0].title}"` : `Added ${added.length} tasks (u to undo)`);
      return added[0]?.id ?? '';
    },

    complete(ids: string[], date: string) {
      let next: Task | null = null;
      update(ids.length > 1 ? `mark ${ids.length} done` : 'mark done', (d) => {
        for (const id of ids) next = completeTask(d, id, date) ?? next;
      });
      const n = next as Task | null;
      const what = ids.length > 1 ? `${ids.length} tasks done` : 'Done';
      const when = date === today ? `${what} ✓` : `${what} on ${relDay(date, today)} ✓`;
      notify(when + (n?.due && ids.length === 1 ? ` · next one due ${relDay(n.due, today)}` : ''));
    },

    reopen(id: string) {
      update('reopen', (d) => {
        const t = find(d, id);
        if (t) t.done = null;
      });
      notify('Marked as not done');
    },

    save(task: Task) {
      update(`edit "${task.title}"`, (d) => {
        const i = d.tasks.findIndex((t) => t.id === task.id);
        if (i >= 0) d.tasks[i] = task;
      });
    },

    /** Pin all to today, or unpin all when they're all pinned already. */
    togglePin(tasks: Task[]) {
      const on = !tasks.every((t) => t.today && t.today <= today);
      update(on ? 'pin to today' : 'unpin from today', (d) => {
        let next = d.tasks.reduce((m, x) => Math.max(m, x.today_order), 0);
        for (const task of tasks) {
          const t = find(d, task.id)!;
          if (on && t.today && t.today <= today) continue;
          t.today = on ? today : null;
          if (on) t.today_order = ++next;
        }
      });
      const n = tasks.length > 1 ? ` (${tasks.length})` : '';
      notify(on ? `★ Pinned to today${n}` : `Unpinned from today${n}`);
    },

    remove(tasks: Task[]) {
      const ids = new Set(tasks.map((t) => t.id));
      update(tasks.length > 1 ? `delete ${tasks.length} tasks` : `delete "${tasks[0].title}"`, (d) => {
        d.tasks = d.tasks.filter((t) => !ids.has(t.id));
      });
      notify(`${tasks.length > 1 ? `Deleted ${tasks.length} tasks` : `Deleted "${tasks[0].title}"`} (u to undo)`);
    },

    /** Add and remove labels on several tasks. */
    relabel(tasks: Task[], add: string[], remove: string[]) {
      update('change labels', (d) => {
        for (const task of tasks) {
          const t = find(d, task.id)!;
          t.labels = [...new Set([...t.labels.filter((l) => !remove.includes(l)), ...add])];
        }
      });
      const parts = [...add.map((l) => '+#' + l), ...remove.map((l) => '-#' + l)].join(' ');
      notify(`${parts} on ${tasks.length} task${tasks.length > 1 ? 's' : ''}`);
    },

    attach(id: string, atts: Attachment[]) {
      if (!atts.length) return;
      update('attach files', (d) => {
        find(d, id)?.attachments.push(...atts);
      });
      notify(`Attached ${atts.map((a) => a.name).join(', ')}`);
    },

    /** Move a task one step within the visible list (manual order). */
    move(task: Task, visible: Task[], dir: -1 | 1, key: 'order' | 'today_order') {
      const i = visible.findIndex((t) => t.id === task.id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= visible.length) return;
      const other = visible[j];
      update('reorder', (d) => {
        // Make all order values unique first, then swap the two.
        [...d.tasks].sort((a, b) => a[key] - b[key] || a.created.localeCompare(b.created)).forEach((t, n) => (t[key] = n * 10));
        const a = find(d, task.id)!;
        const b = find(d, other.id)!;
        [a[key], b[key]] = [b[key], a[key]];
      });
    },

    /** Drop `task` at the position of `target` (mouse drag). */
    moveTo(task: Task, target: Task, visible: Task[], key: 'order' | 'today_order') {
      if (task.id === target.id) return;
      const ids = visible.map((t) => t.id).filter((id) => id !== task.id);
      const at = ids.indexOf(target.id) + (visible.indexOf(task) < visible.indexOf(target) ? 1 : 0);
      ids.splice(at, 0, task.id);
      update('reorder', (d) => {
        const slots = ids.map((id) => find(d, id)![key]).sort((a, b) => a - b);
        // Equal values can't hold an order: spread them out.
        const unique = new Set(slots).size === slots.length;
        ids.forEach((id, n) => (find(d, id)![key] = unique ? slots[n] : (slots[0] ?? 0) + n));
      });
    },
  };

  const flows = {
    /** `suffix` adds tokens from the current view, e.g. "#project:apollo" or "*" for Today. */
    quickAdd(suffix = '', onAdded?: (id: string) => void) {
      openModal((close) => <QuickAdd onClose={close} onAdd={(line) => onAdded?.(actions.add(`${line} ${suffix}`))} />);
    },
    done(tasks: Task[]) {
      const one = tasks.length === 1 ? tasks[0] : null;
      // Several tasks: a stand-in so the dialog shows "3 tasks" and never offers "not done".
      const shown: Task = one ?? { ...tasks[0], title: `${tasks.length} tasks`, done: null, recur: tasks.some((t) => t.recur) ? 'yes' : null };
      openModal((close) => (
        <DonePrompt
          task={shown}
          today={today}
          onClose={close}
          onDone={(date) => actions.complete(tasks.map((t) => t.id), date)}
          onReopen={() => one && actions.reopen(one.id)}
        />
      ));
    },
    edit(task: Task) {
      openModal((close) => <EditTask task={task} onClose={close} onSave={actions.save} />);
    },
    /** Toggle: when all are waiting, stop waiting; otherwise ask on whom. */
    waiting(tasks: Task[]) {
      if (tasks.every((t) => t.waiting)) {
        update('stop waiting', (d) => {
          for (const t of tasks) find(d, t.id)!.waiting = null;
        });
        return notify(tasks.length > 1 ? `No longer waiting (${tasks.length})` : `No longer waiting on ${tasks[0].waiting!.on}`);
      }
      openModal((close) => (
        <Prompt
          title={tasks.length > 1 ? `${tasks.length} tasks waiting on…` : 'Waiting on…'}
          label="Who / what"
          hint={<>e.g. Marc, Ops team, client answer · <kbd>⏎</kbd> save</>}
          validate={(v) => (v.trim() ? null : '!Type who or what you are waiting on')}
          onClose={close}
          onSubmit={(v) =>
            update('waiting', (d) => {
              for (const t of tasks) {
                const x = find(d, t.id)!;
                // Keep the original "since" when it's already waiting on the same person.
                x.waiting = { on: v.trim(), since: x.waiting?.on === v.trim() ? x.waiting.since : today };
              }
            })
          }
        />
      ));
    },
    snooze(tasks: Task[]) {
      const task = tasks[0];
      openModal((close) => (
        <Prompt
          title={tasks.length > 1 ? `Snooze ${tasks.length} tasks until…` : 'Snooze until…'}
          label="Date"
          initial={tasks.length === 1 ? (task.snooze_until ?? '') : ''}
          hint={<>mon, +3, +2w, 2026-12-01 · empty = wake up now · <kbd>⏎</kbd> save</>}
          validate={(v) => {
            if (!v.trim()) return tasks.some((t) => t.snooze_until) ? 'Remove snooze' : null;
            const d = parseDate(v, today);
            if (!d) return '!Unknown date';
            return d <= today ? '!Pick a date after today' : `Hidden until ${relDay(d, today)}`;
          }}
          onClose={close}
          onSubmit={(v) => {
            const d = v.trim() ? parseDate(v, today) : null;
            update(d ? 'snooze' : 'unsnooze', (doc) => {
              for (const t of tasks) find(doc, t.id)!.snooze_until = d;
            });
            notify(d ? `💤 Snoozed until ${relDay(d, today)}` : 'Snooze removed');
          }}
        />
      ));
    },
    remove(tasks: Task[]) {
      openModal((close) => (
        <Confirm
          text={tasks.length > 1 ? <>Delete <strong>{tasks.length} tasks</strong>?</> : <>Delete <strong>{tasks[0].title}</strong>?</>}
          onClose={close}
          onYes={() => actions.remove(tasks)}
        />
      ));
    },
    /** `l`: "+#a -#b" adds/removes labels; a bare "#a" adds. */
    labels(tasks: Task[]) {
      openModal((close) => (
        <Prompt
          title={tasks.length > 1 ? `Labels for ${tasks.length} tasks` : 'Labels'}
          label="Add / remove"
          hint={<><code>#project:apollo</code> or <code>+#urgent</code> adds · <code>-#urgent</code> removes · <kbd>⏎</kbd> apply</>}
          validate={(v) => {
            const { add, remove } = parseRelabel(v, doc.settings.label_aliases);
            if (!add.length && !remove.length) return v.trim() ? '!Use #label, +#label or -#label' : null;
            return [...add.map((l) => '+#' + l), ...remove.map((l) => '-#' + l)].join(' ');
          }}
          onClose={close}
          onSubmit={(v) => {
            const { add, remove } = parseRelabel(v, doc.settings.label_aliases);
            if (add.length || remove.length) actions.relabel(tasks, add, remove);
          }}
        />
      ));
    },
    /** `o`: open the Jira/link ref or an attachment. With one target it opens directly. */
    open(task: Task) {
      const link = task.ref ? jiraUrl(task.ref, doc.settings) : null;
      const targets: { label: string; run: () => void }[] = [];
      if (link) targets.push({ label: `🔗 ${task.ref}`, run: () => window.open(link, '_blank') });
      for (const a of task.attachments) targets.push({ label: `📎 ${a.name}`, run: () => openAttachment(a, notify) });
      if (!targets.length) {
        if (task.ref && /^[A-Z][A-Z0-9]+-\d+$/.test(task.ref)) return notify('Set your Jira URL in settings (,) to open Jira keys', 'error');
        return notify('Nothing to open: no link or attachments');
      }
      if (targets.length === 1) return targets[0].run();
      openModal((close) => (
        <Modal
          title="Open…"
          onClose={close}
          onKey={(k) => {
            const n = Number(k);
            if (n >= 1 && n <= targets.length) {
              close();
              targets[n - 1].run();
              return true;
            }
          }}
          footer={<>press a number · <kbd>esc</kbd> close</>}
        >
          <div className="menu" data-autofocus tabIndex={-1}>
            {targets.map((t, i) => (
              <div key={i} className="menu-item" onClick={() => (close(), t.run())}>
                <kbd>{i + 1}</kbd> {t.label}
              </div>
            ))}
          </div>
        </Modal>
      ));
    },
  };

  return { ...actions, flows };
}

