import { useRef, useState } from 'react';
import type { Attachment } from '../../shared/types';
import { api, attachmentUrl, filesFrom, isImage, pastedName } from '../api';
import { useStore } from '../store';
import { renderMarkdown } from '../util';

export async function uploadAll(files: File[], notify: (t: string, k?: 'info' | 'error') => void): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const f of files) {
    try {
      out.push(await api.upload(f, pastedName(f)));
    } catch (e) {
      notify(`Upload of ${f.name} failed: ${(e as Error).message}`, 'error');
    }
  }
  return out;
}

export function attachmentMarkdown(a: Attachment): string {
  return isImage(a.name) ? `![${a.name}](${attachmentUrl(a.file)})` : `[📎 ${a.name}](${attachmentUrl(a.file)})`;
}

/**
 * Markdown textarea with live preview. Pasting or dropping screenshots/files uploads them and
 * inserts them at the cursor. `onAttach` also receives them (e.g. to list them on a task).
 */
export function MarkdownEditor({
  value,
  onChange,
  onAttach,
  placeholder,
  rows = 12,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onAttach?: (a: Attachment[]) => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}) {
  const { notify } = useStore();
  const ta = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(true);

  async function insertFiles(files: File[]) {
    if (!files.length) return;
    const el = ta.current!;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setBusy(true);
    const atts = await uploadAll(files, notify);
    setBusy(false);
    if (!atts.length) return;
    const md = atts.map(attachmentMarkdown).join('\n');
    const cur = el.value;
    const before = cur.slice(0, start);
    const sep = before && !before.endsWith('\n') ? '\n' : '';
    const next = before + sep + md + '\n' + cur.slice(end);
    onChange(next);
    onAttach?.(atts);
    requestAnimationFrame(() => {
      const pos = (before + sep + md + '\n').length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className={`md-editor ${preview ? 'with-preview' : ''}`}>
      <div className="md-input">
        <textarea
          ref={ta}
          data-autofocus={autoFocus ? '' : undefined}
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const files = filesFrom(e.clipboardData);
            if (files.length) {
              e.preventDefault();
              void insertFiles(files);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const files = filesFrom(e.dataTransfer);
            if (files.length) {
              e.preventDefault();
              void insertFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
              e.preventDefault();
              setPreview((p) => !p);
            }
          }}
        />
        <div className="md-hint">
          {busy ? 'Uploading…' : 'Markdown · paste or drop screenshots & files · ctrl+p preview'}
        </div>
      </div>
      {preview && <div className="md-preview markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />}
    </div>
  );
}
