import { addDays, prettyDay } from '../../shared/dates';
import { standup, waitingDays } from '../../shared/logic';
import type { Task } from '../../shared/types';
import { useStore } from '../store';
import { copyRich, renderMarkdown } from '../util';
import { Modal } from './Modal';

const line = (t: Task) => `- ${t.title}${t.ref && !t.title.includes(t.ref) ? ` (${t.ref})` : ''}`;

export function standupMarkdown(s: ReturnType<typeof standup>, today: string): string {
  const head = s.since === addDays(today, -1) ? 'Yesterday' : `Since ${prettyDay(s.since)}`;
  const out = [`**${head}**`, ...(s.yesterday.length ? s.yesterday.map(line) : ['- (nothing marked done)'])];
  out.push('', '**Today**', ...(s.today.length ? s.today.map(line) : ['- (nothing planned yet)']));
  if (s.blocked.length) {
    out.push('', '**Blocked / waiting**');
    for (const t of s.blocked) {
      const d = waitingDays(t, today);
      out.push(`- ${t.title}: waiting on ${t.waiting!.on}${d ? ` for ${d} day${d > 1 ? 's' : ''}` : ''}`);
    }
  }
  return out.join('\n') + '\n';
}

/** Preview of "Yesterday / Today / Blocked"; Enter or c copies it for Teams. */
export function StandupDialog({ onClose }: { onClose: () => void }) {
  const { doc, archive, today, notify } = useStore();
  const md = standupMarkdown(standup(doc, archive, today), today);
  const copy = async () => {
    await copyRich(renderMarkdown(md), md);
    notify('Standup copied: paste it in Teams');
    onClose();
  };
  return (
    <Modal
      title="Standup"
      onClose={onClose}
      onKey={(k) => (k === 'Enter' || k === 'c' ? (void copy(), true) : false)}
      footer={
        <>
          <kbd>⏎</kbd>/<kbd>c</kbd> copy · <kbd>esc</kbd> close · Today = your ★ list and tasks due · pin with <kbd>*</kbd>
        </>
      }
    >
      <div className="standup markdown" data-autofocus tabIndex={-1} dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
    </Modal>
  );
}
