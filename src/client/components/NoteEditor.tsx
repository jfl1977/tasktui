import { useState } from 'react';
import { MarkdownEditor } from './MarkdownEditor';
import { Modal } from './Modal';

/** Day or week note. Esc, Ctrl+Enter and Ctrl+S all save and close, so a note is never lost. */
export function NoteEditor({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  initial: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const done = () => {
    if (text !== initial) onSave(text);
    onClose();
  };
  return (
    <Modal
      title={title}
      wide
      onClose={done}
      onKey={(k) => {
        if (k === 'ctrl+Enter' || k === 'ctrl+s') return done(), true;
      }}
      footer={
        <>
          <kbd>esc</kbd>/<kbd>ctrl+⏎</kbd> save &amp; close · paste screenshots with <kbd>ctrl+v</kbd>
        </>
      }
    >
      <MarkdownEditor value={text} onChange={setText} rows={18} autoFocus placeholder="What happened, meetings, blockers, plans…" />
    </Modal>
  );
}
