import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useRef } from 'react';
import { labelParts } from '../shared/parse';
import type { Settings } from '../shared/types';

marked.setOptions({ gfm: true, breaks: true });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener');
  }
});

export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md || '', { async: false }) as string);
}

/** True when the focused element takes text, i.e. we're in EDIT mode. */
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit'].includes(type);
  }
  return (el as HTMLElement).isContentEditable;
}

/** Describe a key event as "ctrl+k", "alt+ArrowUp", "shift+?"→"?" etc. */
export function keyName(e: KeyboardEvent | React.KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  // Printable keys already reflect shift ("S", "?"), so only name shift for special keys.
  if (e.key.length !== 1 && e.shiftKey) parts.push('shift');
  parts.push(e.key === ' ' ? 'space' : e.key);
  return parts.join('+');
}

/** Global key handler that's only active while `active` is true. */
export function useKeys(active: boolean, handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active]);
}

export function jiraUrl(ref: string, settings: Settings): string | null {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(ref) && settings.jira_url) return settings.jira_url.replace(/\/?$/, '/') + ref;
  return null;
}

export function labelText(l: string): string {
  const [type, value] = labelParts(l);
  return type ? `${type}:${value}` : value;
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export async function copyRich(html: string, text: string) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

export function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
