import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { toISODate } from '../shared/dates';
import type { Doc, Task } from '../shared/types';
import { api, ConflictError } from './api';

interface Flash {
  text: string;
  kind: 'info' | 'error';
  id: number;
}

interface Store {
  doc: Doc;
  archive: Task[];
  dataDir: string;
  today: string;
  saving: boolean;
  flash: Flash | null;
  /** Apply a change. `label` is shown when undoing. */
  update: (label: string, fn: (d: Doc) => void) => void;
  undo: () => void;
  notify: (text: string, kind?: 'info' | 'error') => void;
  replaceAll: (doc: Doc, archive?: Task[]) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

const MAX_UNDO = 200;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [archive, setArchive] = useState<Task[]>([]);
  const [dataDir, setDataDir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [today, setToday] = useState(() => toISODate(new Date()));

  const docRef = useRef<Doc | null>(null);
  const undoStack = useRef<{ label: string; doc: Doc }[]>([]);
  const dirty = useRef(false);
  const savingRef = useRef(false);

  const notify = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setFlash({ text, kind, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash((f) => (f?.id === flash.id ? null : f)), flash.kind === 'error' ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [flash]);

  // Keep "today" correct if the app stays open past midnight.
  useEffect(() => {
    const i = setInterval(() => setToday(toISODate(new Date())), 60_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    api
      .load()
      .then((r) => {
        docRef.current = r.doc;
        setDoc(r.doc);
        setArchive(r.archive);
        setDataDir(r.dataDir);
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  const flush = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      while (dirty.current && docRef.current) {
        dirty.current = false;
        try {
          const { doc: saved } = await api.save(docRef.current);
          // Local edits may have happened during the request: keep them, just take the new rev.
          docRef.current = { ...docRef.current, rev: saved.rev };
          setDoc(docRef.current);
        } catch (e) {
          if (e instanceof ConflictError) {
            docRef.current = e.doc;
            setDoc(e.doc);
            undoStack.current = [];
            notify('Changed in another window: reloaded the latest version. Your last change was not saved.', 'error');
          } else {
            dirty.current = true;
            notify(`Could not save: ${(e as Error).message}. Retrying…`, 'error');
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [notify]);

  const commit = useCallback(
    (next: Doc) => {
      docRef.current = next;
      setDoc(next);
      dirty.current = true;
      void flush();
    },
    [flush],
  );

  const update = useCallback(
    (label: string, fn: (d: Doc) => void) => {
      const cur = docRef.current;
      if (!cur) return;
      const next = structuredClone(cur);
      fn(next);
      undoStack.current.push({ label, doc: cur });
      if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
      commit(next);
    },
    [commit],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev || !docRef.current) return notify('Nothing to undo');
    commit({ ...prev.doc, rev: docRef.current.rev });
    notify(`Undid: ${prev.label}`);
  }, [commit, notify]);

  const replaceAll = useCallback((d: Doc, arch?: Task[]) => {
    docRef.current = d;
    setDoc(d);
    if (arch) setArchive(arch);
    undoStack.current = [];
  }, []);

  // Warn before closing the window with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current || savingRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  if (error)
    return (
      <div className="fatal">
        <h1>tasktui can't reach its server</h1>
        <p>{error}</p>
        <p>Start it with the tasktui shortcut, or run <code>node dist/server.js</code>, then reload.</p>
      </div>
    );
  if (!doc) return <div className="fatal">Loading…</div>;

  return (
    <Ctx.Provider value={{ doc, archive, dataDir, today, saving, flash, update, undo, notify, replaceAll }}>
      {children}
    </Ctx.Provider>
  );
}
