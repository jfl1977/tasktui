import { useEffect, useRef, useState, type ReactNode } from 'react';
import { keyName } from '../util';

export function Modal({
  title,
  children,
  onClose,
  onKey,
  wide,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** Return true when the key was handled. */
  onKey?: (k: string, e: React.KeyboardEvent) => boolean | void;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus the first field, or the dialog itself so keys reach it.
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select');
    (first ?? ref.current)?.focus();
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`modal ${wide ? 'wide' : ''}`}
        onKeyDown={(e) => {
          const k = keyName(e);
          if (onKey?.(k, e)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (k === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
          e.stopPropagation(); // keep NAV shortcuts from firing behind the dialog
        }}
      >
        <div className="modal-title">{title}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ text, onYes, onClose }: { text: ReactNode; onYes: () => void; onClose: () => void }) {
  return (
    <Modal
      title="Confirm"
      onClose={onClose}
      onKey={(k) => {
        if (k === 'y' || k === 'Enter') {
          onClose();
          onYes();
          return true;
        }
        if (k === 'n') {
          onClose();
          return true;
        }
      }}
      footer={
        <>
          <kbd>y</kbd>/<kbd>⏎</kbd> yes · <kbd>n</kbd>/<kbd>esc</kbd> no
        </>
      }
    >
      <div>{text}</div>
    </Modal>
  );
}

export function Prompt({
  title,
  label,
  initial = '',
  hint,
  validate,
  onSubmit,
  onClose,
  extraKeys,
}: {
  title: string;
  label: string;
  initial?: string;
  hint?: ReactNode;
  /** Return a preview string, or an error starting with "!" */
  validate?: (v: string) => string | null;
  onSubmit: (v: string) => void;
  onClose: () => void;
  extraKeys?: (k: string) => boolean | void;
}) {
  const [v, setV] = useState(initial);
  const check = validate?.(v) ?? null;
  const bad = check?.startsWith('!');
  return (
    <Modal
      title={title}
      onClose={onClose}
      onKey={(k) => {
        if (k === 'Enter') {
          if (!bad) {
            onClose();
            onSubmit(v);
          }
          return true;
        }
        return extraKeys?.(k);
      }}
      footer={hint}
    >
      <label className="field">
        <span>{label}</span>
        <input value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()} />
      </label>
      {check && <div className={bad ? 'error' : 'preview'}>{bad ? check.slice(1) : check}</div>}
    </Modal>
  );
}
