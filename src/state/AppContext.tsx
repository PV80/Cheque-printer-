import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { can } from '../core/auth';
import { createIssueChecker, type Issue } from '../core/issues';
import { buildQueue, type QueueGroup } from '../core/queue';
import { emptyStore, logEvent, parseStore, serializeStore, setSignatureResult, StoreError, type Ctx } from '../core/store';
import type { Cheque, Store, User } from '../core/types';
import { api } from '../platform/api';
import type { AppInfo } from '../platform/api-types';
import { measureText } from '../platform/measure';
import { openPdf } from '../platform/pdf';
import { importPdfFile, signatureResult, type ImportOutcome } from './importer';

export type Tab = 'import' | 'held' | 'queue' | 'register' | 'setup';

export interface ImportRow extends ImportOutcome {
  id: string;
  filename: string;
}

export interface Toast {
  id: number;
  kind: 'error' | 'success' | 'info';
  text: string;
}

type Boot = { phase: 'loading' } | { phase: 'failed'; message: string } | { phase: 'ready' };

export type StoreAction = (store: Store, ctx: Ctx) => Store;

interface AppContextValue {
  boot: Boot;
  store: Store;
  user: User | null;
  info: AppInfo | null;
  tab: Tab;
  setTab: (tab: Tab) => void;

  /**
   * Applies a change as the signed-in user (or as `approver`, for a
   * supervisor override). Shows the reason and returns false if refused.
   */
  run: (action: StoreAction, approver?: User) => boolean;
  /** Waits until every change so far is on disk. False if saving failed. */
  flushSaves: () => Promise<boolean>;
  /** Replaces all data — first-time setup and restoring a backup only. */
  replaceStore: (store: Store) => void;
  signIn: (user: User) => void;
  signOut: () => void;

  issuesOf: (cheque: Cheque) => Issue[];
  held: Cheque[];
  queue: QueueGroup[];

  imports: ImportRow[];
  importFiles: (files: File[]) => void;
  clearImports: () => void;

  toasts: Toast[];
  notify: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  saveError: string | null;
  /** The newest save was unreadable at start-up and the previous copy was loaded instead. */
  recovered: boolean;
  dismissRecovered: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

let toastCounter = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const [store, setStore] = useState<Store>(() => emptyStore());
  const [user, setUser] = useState<User | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [tab, setTab] = useState<Tab>('import');
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);

  // The latest data and user, readable from callbacks that outlive a render.
  const storeRef = useRef(store);
  const userRef = useRef(user);
  const bootRef = useRef(boot);
  bootRef.current = boot;

  // ---- Messages ---------------------------------------------------------------

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (kind: Toast['kind'], text: string) => {
      const id = ++toastCounter;
      setToasts((t) => [...t.slice(-3), { id, kind, text }]);
      window.setTimeout(() => dismissToast(id), kind === 'error' ? 10000 : 5000);
    },
    [dismissToast]
  );

  // ---- Saving -------------------------------------------------------------------

  const saving = useRef({ busy: false, next: null as string | null, failed: false, idle: Promise.resolve() });
  const persist = useCallback((next: Store) => {
    if (bootRef.current.phase !== 'ready') return; // never write over data that failed to load
    const json = serializeStore(next);
    if (saving.current.busy) {
      saving.current.next = json;
      return;
    }
    saving.current.busy = true;
    saving.current.idle = (async () => {
      let payload: string | null = json;
      while (payload !== null) {
        try {
          await api.saveStore(payload);
          saving.current.failed = false;
          setSaveError(null);
        } catch (err) {
          saving.current.failed = true;
          setSaveError(err instanceof Error ? err.message : 'Unknown error');
        }
        payload = saving.current.next;
        saving.current.next = null;
      }
      saving.current.busy = false;
      // A failed save is tried again shortly, not left until the next change.
      if (saving.current.failed) window.setTimeout(() => persistRef.current(storeRef.current), 5000);
    })();
  }, []);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  /** Resolves once everything so far is on disk. False if the last save failed. */
  const flushSaves = useCallback(async (): Promise<boolean> => {
    await saving.current.idle;
    return !saving.current.failed;
  }, []);

  const commit = useCallback(
    (next: Store) => {
      if (next === storeRef.current) return;
      storeRef.current = next;
      setStore(next);
      persist(next);
    },
    [persist]
  );

  // ---- Start-up -------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [loaded, appInfo] = await Promise.all([api.loadStore(), api.getInfo()]);
        if (cancelled) return;
        setInfo(appInfo);
        if (loaded.status === 'corrupt') {
          setBoot({ phase: 'failed', message: loaded.message });
          return;
        }
        const initial = loaded.status === 'ok' ? parseStore(loaded.json) : emptyStore();
        storeRef.current = initial;
        setStore(initial);
        setBoot({ phase: 'ready' });
        if (loaded.status === 'ok' && loaded.recovered) setRecovered(true);
      } catch (err) {
        if (cancelled) return;
        setBoot({ phase: 'failed', message: err instanceof Error ? err.message : 'The data could not be loaded.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify]);

  // ---- Changing data ----------------------------------------------------------------

  const run = useCallback(
    (action: StoreAction, approver?: User): boolean => {
      const actor = approver ?? userRef.current;
      if (!actor) return false;
      try {
        commit(action(storeRef.current, { actor, now: new Date().toISOString(), newId: () => crypto.randomUUID() }));
        return true;
      } catch (err) {
        if (err instanceof StoreError) {
          notify('error', err.message);
          return false;
        }
        throw err;
      }
    },
    [commit, notify]
  );

  const replaceStore = useCallback((next: Store) => commit(next), [commit]);

  const signIn = useCallback(
    (next: User) => {
      userRef.current = next;
      setUser(next);
      setTab('import');
      run((s, ctx) => logEvent(s, ctx, 'Signed in', next.username));
    },
    [run]
  );

  const signOut = useCallback(() => {
    userRef.current = null;
    setUser(null);
    setImports([]);
    setToasts([]); // messages meant for one person are not left for the next
    setTab('import');
  }, []);

  // Sign out automatically when the app is left alone.
  const lockMinutes = store.settings.autoLockMinutes;
  useEffect(() => {
    if (!user || lockMinutes <= 0) return;
    let timer = window.setTimeout(signOut, lockMinutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(signOut, lockMinutes * 60_000);
    };
    const events = ['mousedown', 'keydown', 'wheel', 'drop'] as const;
    events.forEach((e) => window.addEventListener(e, reset, true));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset, true));
    };
  }, [user, lockMinutes, signOut]);

  // ---- Signature re-checks ------------------------------------------------------------
  // Runs whenever a requisition is waiting for a check: after its company is
  // assigned, or after the company's signature box is set or moved.

  const checking = useRef(new Set<string>());
  useEffect(() => {
    if (boot.phase !== 'ready') return;
    for (const cheque of store.cheques) {
      if (cheque.status !== 'pending' || !cheque.companyId) continue;
      const companyId = cheque.companyId;
      const zones = store.companies.find((c) => c.id === companyId)?.signatureZones;
      if (!zones) continue;

      for (const req of cheque.requisitions) {
        const zone = zones[req.documentType];
        if (req.signature.status !== 'unchecked' || !zone?.length) continue;
        const zoneKey = JSON.stringify(zone);
        const key = `${req.id}|${zoneKey}`;
        if (checking.current.has(key)) continue;
        checking.current.add(key);

        void (async () => {
          try {
            const bytes = await api.readPdf(req.fileHash);
            if (!bytes) return; // archive copy missing: stays "not checked"
            const pdf = await openPdf(bytes);
            try {
              const result = await signatureResult(pdf, zone);
              const current = storeRef.current.companies.find((c) => c.id === companyId)?.signatureZones[req.documentType];
              if (JSON.stringify(current) === zoneKey) {
                commit(setSignatureResult(storeRef.current, cheque.id, req.id, result));
              }
              checking.current.delete(key);
            } finally {
              void pdf.destroy();
            }
          } catch (err) {
            console.error('Signature check failed', err);
          }
        })();
      }
    }
  }, [store, boot.phase, commit]);

  // ---- Importing ------------------------------------------------------------------------

  const importChain = useRef<Promise<void>>(Promise.resolve());
  const importFiles = useCallback(
    (files: File[]) => {
      const current = userRef.current;
      if (!current || files.length === 0) return;
      if (!can(current, 'import')) {
        notify('error', 'You do not have permission to load requisitions.');
        return;
      }
      // One file at a time, so each is checked against the ones before it.
      importChain.current = importChain.current.then(async () => {
        for (const file of files) {
          const id = crypto.randomUUID();
          setImports((rows) => [{ id, filename: file.name, state: 'working', message: 'Reading…' }, ...rows]);
          let outcome: ImportOutcome;
          try {
            outcome = await importPdfFile(file, { user: current, getStore: () => storeRef.current, run });
          } catch (err) {
            console.error('Import failed', err);
            outcome = { state: 'error', message: 'Something went wrong reading this file.' };
          }
          setImports((rows) => rows.map((r) => (r.id === id ? { ...r, ...outcome } : r)));
        }
      });
    },
    [notify, run]
  );

  const clearImports = useCallback(() => setImports((rows) => rows.filter((r) => r.state === 'working')), []);

  // ---- Derived lists -----------------------------------------------------------------------

  const issuesOf = useMemo(() => {
    const check = createIssueChecker(store, measureText);
    const cache = new Map<string, Issue[]>();
    return (cheque: Cheque) => {
      let issues = cache.get(cheque.id);
      if (!issues) {
        issues = check(cheque);
        cache.set(cheque.id, issues);
      }
      return issues;
    };
  }, [store]);

  const held = useMemo(
    () =>
      store.cheques
        .filter((c) => c.status === 'pending' && issuesOf(c).length > 0)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [store, issuesOf]
  );

  const queue = useMemo(() => buildQueue(store, (c) => issuesOf(c).length === 0), [store, issuesOf]);

  const value: AppContextValue = {
    boot,
    store,
    user,
    info,
    tab,
    setTab,
    run,
    flushSaves,
    replaceStore,
    signIn,
    signOut,
    issuesOf,
    held,
    queue,
    imports,
    importFiles,
    clearImports,
    toasts,
    notify,
    dismissToast,
    saveError,
    recovered,
    dismissRecovered: () => setRecovered(false),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
