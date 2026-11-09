import type { Attachment } from '../../shared/types';
import { api, attachmentUrl, isImage } from '../api';

/** Images show in the in-app viewer, PDFs/text in a browser tab, everything else in its Windows app. */
export function openAttachment(a: Attachment, notify: (t: string, k?: 'info' | 'error') => void) {
  if (isImage(a.name)) {
    window.dispatchEvent(new CustomEvent('tasktui:lightbox', { detail: attachmentUrl(a.file) }));
  } else if (/\.(pdf|txt|md|json|csv|log)$/i.test(a.name)) {
    window.open(attachmentUrl(a.file), '_blank');
  } else {
    api.open(a.file).then(
      () => notify(`Opening ${a.name}…`),
      (e) => notify(`Cannot open ${a.name}: ${e.message}`, 'error'),
    );
  }
}

export function AttachmentList({
  items,
  onRemove,
  onOpen,
}: {
  items: Attachment[];
  onRemove?: (file: string) => void;
  onOpen?: (a: Attachment) => void;
}) {
  if (!items.length) return <div className="dim">None. Paste (ctrl+v) or drop files to attach.</div>;
  return (
    <div className="attachments">
      {items.map((a) => (
        <div key={a.file} className="attachment">
          {isImage(a.name) ? (
            <img src={attachmentUrl(a.file)} alt={a.name} onClick={() => onOpen?.(a)} />
          ) : (
            <span className="file-icon" onClick={() => onOpen?.(a)}>
              📄
            </span>
          )}
          <span className="name" title={a.name} onClick={() => onOpen?.(a)}>
            {a.name}
          </span>
          {onRemove && (
            <button type="button" title="Remove" onClick={() => onRemove(a.file)}>
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
