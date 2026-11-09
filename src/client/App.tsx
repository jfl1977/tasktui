import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, fromISODate, toISODate } from '../shared/dates';
import { archiveCandidates } from '../shared/logic';
import { api, ConflictError } from './api';
import { Confirm, Modal } from './components/Modal';
import { NoteEditor } from './components/NoteEditor';
import { Help, Lightbox, Settings } from './components/Panels';
import { Search, type SearchHit } from './components/Search';
import { TaskDetails, TasksView } from './components/TasksView';
import { TimeCorrectionForm } from './components/TimeCorrectionForm';
import { WeekView } from './components/WeekView';
import { useStore } from './store';
import { UICtx } from './ui';
import { isEditable, keyName } from './util';

type Tab = 'tasks' | 'week';

/** Monday of an ISO week key like "2026-W45". */
function mondayOfWeekKey(key: string): string {
  const [y, w] = [Number(key.slice(0, 4)), Number(key.slice(6))];
  const jan4 = toISODate(new Date(y, 0, 4));
  const dow = (fromISODate(jan4).getDay() + 6) % 7;
  return addDays(addDays(jan4, -dow), (w - 1) * 7);
}

const HINTS: Record<Tab, string[]> = {
  tasks: ['a add', '⏎ done', 'c standup', 'e edit', '* today', 'w wait', 's snooze', 'o open', 'g group', '/ search', '? help'],
  week: ['h/l week', '⏎ edit', 'e week note', 't time', 'space entered', 'c copy', 'g group', '? help'],
};

export function App() {
  const store = useStore();
  const { doc, today, update, undo, notify, flash, saving, replaceAll } = store;
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem('tasktui.tab') as Tab) || 'tasks';
    } catch {
      return 'tasks';
    }
  });
  const [modal, setModal] = useState<{ render: (close: () => void) => ReactNode; id: number } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [tasksJump, setTasksJump] = useState<{ id: string; n: number } | null>(null);
  const [weekJump, setWeekJump] = useState<{ date?: string; correction?: string; n: number } | null>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('tasktui.tab', tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  // EDIT mode follows focus.
  useEffect(() => {
    const sync = () => setEditing(isEditable(document.activeElement));
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', () => setTimeout(sync));
    return () => document.removeEventListener('focusin', sync);
  }, []);

  useEffect(() => {
    const h = (e: Event) => setLightbox((e as CustomEvent<string>).detail);
    // Clicking an image inside a note or description zooms it.
    const click = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'IMG' && el.closest('.markdown')) {
        e.preventDefault();
        setLightbox((el as HTMLImageElement).getAttribute('src'));
      }
    };
    window.addEventListener('tasktui:lightbox', h);
    window.addEventListener('click', click);
    return () => {
      window.removeEventListener('tasktui:lightbox', h);
      window.removeEventListener('click', click);
    };
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    // Give focus back to the page so NAV keys work again.
    requestAnimationFrame(() => {
      if (isEditable(document.activeElement)) (document.activeElement as HTMLElement).blur();
      (lastFocus.current as HTMLElement | null)?.focus?.();
    });
  }, []);
  const openModal = useCallback((render: (close: () => void) => ReactNode) => {
    lastFocus.current = document.activeElement;
    setModal({ render, id: Date.now() });
  }, []);

  const archiveNow = useCallback(async () => {
    try {
      const r = await api.archive(doc.rev);
      replaceAll(r.doc, r.archive);
      notify(r.moved ? `Archived ${r.moved} task(s). They stay searchable and in week views.` : 'Nothing to archive');
    } catch (e) {
      if (e instanceof ConflictError) replaceAll(e.doc);
      notify(`Archive failed: ${(e as Error).message}`, 'error');
    }
  }, [doc.rev, replaceAll, notify]);

  const offerArchive = useCallback(
    (force: boolean) => {
      const n = archiveCandidates(doc, today).length;
      if (!n) return force && notify(`No tasks done more than ${doc.settings.archive_after_days} days ago`);
      openModal((close) => (
        <Confirm
          text={
            <>
              {n} task(s) were done more than {doc.settings.archive_after_days} days ago. Move them to the archive?
              <div className="dim">Archived tasks still show in week views and search.</div>
            </>
          }
          onClose={close}
          onYes={archiveNow}
        />
      ));
    },
    [doc, today, openModal, archiveNow, notify],
  );

  // Suggest archiving once per day at startup.
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current) return;
    offered.current = true;
    let last = '';
    try {
      last = localStorage.getItem('tasktui.archiveAsked') ?? '';
      localStorage.setItem('tasktui.archiveAsked', today);
    } catch {
      /* ignore */
    }
    if (last !== today) offerArchive(false);
  }, [offerArchive, today]);

  const openDayNote = (date: string) =>
    openModal((close) => (
      <NoteEditor
        title={`Day note · ${date === today ? 'today' : date}`}
        initial={doc.days[date] ?? ''}
        onClose={close}
        onSave={(text) => update('edit day note', (d) => void (text.trim() ? (d.days[date] = text) : delete d.days[date]))}
      />
    ));

  const pick = (h: SearchHit) => {
    const n = Date.now();
    if (h.kind === 'task') {
      if (h.archived) {
        return openModal((close) => (
          <Modal title="Archived task" wide onClose={close}>
            <div data-autofocus tabIndex={-1}>
              <TaskDetails task={h.task} />
            </div>
          </Modal>
        ));
      }
      setTab('tasks');
      return setTasksJump({ id: h.task.id, n });
    }
    setTab('week');
    if (h.kind === 'day') setWeekJump({ date: h.date, n });
    else if (h.kind === 'week') setWeekJump({ date: mondayOfWeekKey(h.week), n });
    else setWeekJump({ date: h.date, correction: h.id, n });
  };

  const openSearch = () => openModal((close) => <Search onClose={close} onPick={pick} />);

  // Global keys.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = keyName(e);
      if (k === 'ctrl+s') return e.preventDefault(); // block "Save page"; we save automatically
      if (k === 'ctrl+k' && !modal) return e.preventDefault(), openSearch();
      if (modal || lightbox) return;
      if (isEditable(document.activeElement)) {
        if (k === 'Escape') (document.activeElement as HTMLElement).blur();
        return;
      }
      const run = (f: () => void) => (e.preventDefault(), f());
      if (k === '1') return run(() => setTab('tasks'));
      if (k === '2' || k === 'W') return run(() => setTab('week'));
      if (k === '/') return run(openSearch);
      if (k === 'u' || k === 'ctrl+z') return run(undo);
      if (k === '?') return run(() => openModal((close) => <Help onClose={close} />));
      if (k === ',') return run(() => openModal((close) => <Settings onClose={close} />));
      if (k === 'A') return run(() => offerArchive(true));
      if (tab === 'tasks') {
        if (k === 'n') return run(() => openDayNote(today));
        if (k === 't')
          return run(() =>
            openModal((close) => (
              <TimeCorrectionForm
                baseDay={today}
                onClose={close}
                onSave={(c) => {
                  update('add time correction', (d) => void d.time_corrections.push(c));
                  notify('Time correction added (see Week view)');
                }}
              />
            )),
          );
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const mode = modal ? (editing ? 'EDIT' : 'DIALOG') : editing ? 'EDIT' : 'NAV';

  return (
    <UICtx.Provider value={{ openModal, modalOpen: !!modal || !!lightbox, editing }}>
      <div className="app">
        <header className="topbar">
          <span className="brand">tasktui</span>
          <button className={`tab ${tab === 'tasks' ? 'on' : ''}`} onClick={() => setTab('tasks')}>
            [1] Tasks
          </button>
          <button className={`tab ${tab === 'week' ? 'on' : ''}`} onClick={() => setTab('week')}>
            [2] Week
          </button>
          <span className="spacer" />
          <button className="tab" onClick={openSearch}>
            / search
          </button>
          <button className="tab" onClick={() => openModal((close) => <Help onClose={close} />)}>
            ? help
          </button>
        </header>
        <main>
          <div className="view" hidden={tab !== 'tasks'}>
            <TasksView active={tab === 'tasks'} jump={tasksJump} />
          </div>
          <div className="view" hidden={tab !== 'week'}>
            <WeekView active={tab === 'week'} jump={weekJump} />
          </div>
        </main>
        <footer className="statusbar">
          <span className={`mode mode-${mode.toLowerCase()}`}>{mode}</span>
          {flash ? (
            <span className={`flash ${flash.kind}`}>{flash.text}</span>
          ) : (
            <span className="hints">
              {mode === 'EDIT'
                ? 'esc leave · ctrl+⏎ save · ctrl+v paste image'
                : modal
                  ? 'esc close'
                  : HINTS[tab].join(' · ')}
            </span>
          )}
          <span className="spacer" />
          <span className="dim">{saving ? 'saving…' : 'saved'}</span>
        </footer>
      </div>
      {modal && <div key={modal.id}>{modal.render(closeModal)}</div>}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </UICtx.Provider>
  );
}
