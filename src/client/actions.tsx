import { parseDate, relDay, toISODateTime } from '../shared/dates';
import { completeTask, minOrder } from '../shared/logic';
import { captureToTask, parseCapture } from '../shared/parse';
import type { Attachment, Doc, Task } from '../shared/types';
import { newTask } from '../shared/types';
import { openAttachment } from './components/Attachments';
import { DonePrompt } from './components/DonePrompt';
import { EditTask } from './components/EditTask';
import { Confirm, Modal, Prompt } from './components/Modal';
import { QuickAdd } from './components/QuickAdd';
import { useStore } from './store';
import { useUI } from './ui';
import { jiraUrl } from './util';

const find = (d: Doc, id: string) => d.tasks.find((t) => t.id === id);

/** Task operations plus the dialogs that drive them. Shared by the views and search. */
export function useTaskActions() {
  const { doc, today, update, notify } = useStore();
  const { openModal } = useUI();

  const actions = {
    add(line: string): string {
      const c = parseCapture(line, today, doc.settings.label_aliases);
      const t = newTask(captureToTask(c, today), toISODateTime(new Date()));
      update(`add "${t.title}"`, (d) => {
        t.order = minOrder(d.tasks, 'order');
        t.today_order = d.tasks.reduce((m, x) => Math.max(m, x.today_order), 0) + 1;
        d.tasks.push(t);
      });
      notify(`Added "${t.title}"`);
      return t.id;
    },

    complete(id: string, date: string) {
      let next: Task | null = null;
      update('mark done', (d) => {
        next = completeTask(d, id, date);
      });
      const n = next as Task | null;
      const when = date === today ? 'Done ✓' : `Done on ${relDay(date, today)} ✓`;
      notify(when + (n?.due ? ` · next one due ${relDay(n.due, today)}` : ''));
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

    togglePin(task: Task) {
      const on = !(task.today && task.today <= today);
      update(on ? 'pin to today' : 'unpin from today', (d) => {
        const t = find(d, task.id)!;
        t.today = on ? today : null;
        if (on) t.today_order = d.tasks.reduce((m, x) => Math.max(m, x.today_order), 0) + 1;
      });
      notify(on ? '★ Pinned to today' : 'Unpinned from today');
    },

    remove(task: Task) {
      update(`delete "${task.title}"`, (d) => {
        d.tasks = d.tasks.filter((t) => t.id !== task.id);
      });
      notify(`Deleted "${task.title}" (u to undo)`);
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
    done(task: Task) {
      openModal((close) => (
        <DonePrompt
          task={task}
          today={today}
          onClose={close}
          onDone={(date) => actions.complete(task.id, date)}
          onReopen={() => actions.reopen(task.id)}
        />
      ));
    },
    edit(task: Task) {
      openModal((close) => <EditTask task={task} onClose={close} onSave={actions.save} />);
    },
    waiting(task: Task) {
      if (task.waiting) {
        update('stop waiting', (d) => {
          find(d, task.id)!.waiting = null;
        });
        return notify(`No longer waiting on ${task.waiting.on}`);
      }
      openModal((close) => (
        <Prompt
          title="Waiting on…"
          label="Who / what"
          hint={<>e.g. Marc, Ops team, client answer · <kbd>⏎</kbd> save</>}
          validate={(v) => (v.trim() ? null : '!Type who or what you are waiting on')}
          onClose={close}
          onSubmit={(v) =>
            update('waiting', (d) => {
              find(d, task.id)!.waiting = { on: v.trim(), since: today };
            })
          }
        />
      ));
    },
    snooze(task: Task) {
      openModal((close) => (
        <Prompt
          title="Snooze until…"
          label="Date"
          initial={task.snooze_until ?? ''}
          hint={<>mon, +3, +2w, 2026-12-01 · empty = wake up now · <kbd>⏎</kbd> save</>}
          validate={(v) => {
            if (!v.trim()) return task.snooze_until ? 'Remove snooze' : null;
            const d = parseDate(v, today);
            if (!d) return '!Unknown date';
            return d <= today ? '!Pick a date after today' : `Hidden until ${relDay(d, today)}`;
          }}
          onClose={close}
          onSubmit={(v) => {
            const d = v.trim() ? parseDate(v, today) : null;
            update(d ? 'snooze' : 'unsnooze', (doc) => {
              find(doc, task.id)!.snooze_until = d;
            });
            notify(d ? `💤 Snoozed until ${relDay(d, today)}` : 'Snooze removed');
          }}
        />
      ));
    },
    remove(task: Task) {
      openModal((close) => (
        <Confirm text={<>Delete <strong>{task.title}</strong>?</>} onClose={close} onYes={() => actions.remove(task)} />
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

