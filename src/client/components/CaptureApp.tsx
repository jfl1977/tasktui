import { useEffect, useState } from 'react';
import type { Attachment } from '../../shared/types';
import { attachmentUrl, filesFrom, isImage } from '../api';
import { useStore } from '../store';
import { uploadAll } from './MarkdownEditor';
import { CaptureBox } from './QuickAdd';

/**
 * The small "capture from anywhere" window (opened by its own hotkey at /capture).
 * Enter adds and closes, Ctrl+Enter adds and stays open, Shift+Enter starts another task line,
 * Ctrl+V attaches a screenshot (to every task being added), Esc closes.
 */
export function CaptureApp() {
  const { notify } = useStore();
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    document.title = 'tasktui · capture';
    // Windows may open the window behind others; grab focus when shown.
    const f = () => document.querySelector<HTMLTextAreaElement>('.capture-app textarea')?.focus();
    f();
    window.addEventListener('focus', f);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && window.close();
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('focus', f);
      window.removeEventListener('keydown', esc);
    };
  }, []);

  async function add(text: string, count: number, stay: boolean) {
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, attachments: atts }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setAtts([]);
      const what = count > 1 ? `${count} tasks` : `"${body.tasks?.[0]?.title}"`;
      setStatus(`✓ Added ${what}`);
      if (!stay) {
        window.close();
        // If the browser refuses to close a window it didn't open, stay usable.
        setTimeout(() => setStatus(`✓ Added ${what}. You can close this window.`), 300);
      }
    } catch (e) {
      notify(`Could not add: ${(e as Error).message}`, 'error');
      setStatus(`✗ ${(e as Error).message}`);
    }
  }

  const attach = async (files: File[]) => {
    setStatus('Uploading…');
    const up = await uploadAll(files, notify);
    setAtts((a) => [...a, ...up]);
    setStatus('');
  };

  return (
    <div
      className="capture-app"
      onPaste={(e) => {
        const files = filesFrom(e.clipboardData);
        if (!files.length) return;
        e.preventDefault();
        void attach(files);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const files = filesFrom(e.dataTransfer);
        if (!files.length) return;
        e.preventDefault();
        void attach(files);
      }}
    >
      <CaptureBox
        placeholder="New task… #project:x @teams PROJ-123 ^fri *"
        onSubmit={(text, count, stay) => void add(text, count, stay)}
        extra={atts.map((a) =>
          isImage(a.name) ? (
            <img key={a.file} className="capture-thumb" src={attachmentUrl(a.file)} alt={a.name} />
          ) : (
            <span key={a.file} className="chip">
              📎 {a.name}
            </span>
          ),
        )}
      />
      <div className="capture-foot">
        <span className={status.startsWith('✗') ? 'error' : 'preview'}>{status}</span>
        <span className="dim">⏎ add · ctrl+⏎ add, keep open · shift+⏎ another task · ctrl+v screenshot · esc close</span>
      </div>
    </div>
  );
}
