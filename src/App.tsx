import { useEffect, useState } from 'react';
import { AlertTriangle, Loader, Upload, X } from 'lucide-react';
import { Header } from './components/Header';
import { HeldTab } from './components/HeldTab';
import { ImportTab } from './components/ImportTab';
import { LoginScreen } from './components/LoginScreen';
import { PayrollModal } from './components/PayrollModal';
import { QueueTab } from './components/QueueTab';
import { RegisterTab } from './components/RegisterTab';
import { SetupTab } from './components/SetupTab';
import { Button } from './components/ui';
import { api, hasDesktopApi } from './platform/api';
import { AppProvider, useApp } from './state/AppContext';

const TOAST_STYLE = {
  error: 'bg-red-600 text-white',
  success: 'bg-green-600 text-white',
  info: 'bg-gray-800 text-white',
};

function Shell() {
  const { boot, user, tab, setTab, importFiles, toasts, dismissToast, saveError, recovered, dismissRecovered, payrollRequest } = useApp();
  const [dragging, setDragging] = useState(false);

  // A PDF can be dropped anywhere in the window, on any tab.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (user) setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!user || files.length === 0) return;
      importFiles(files);
      setTab('import');
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [user, importFiles, setTab]);

  if (boot.phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 gap-3">
        <Loader className="animate-spin" size={20} /> Loading…
      </div>
    );
  }

  if (boot.phase === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg bg-white border border-red-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-red-700 font-semibold mb-2">
            <AlertTriangle size={20} /> The cheque data could not be opened
          </div>
          <p className="text-sm text-gray-700 mb-4">{boot.message}</p>
          <p className="text-sm text-gray-500 mb-4">
            Nothing has been changed. Close the app, restore a backup copy, then open it again.
          </p>
          <Button onClick={() => void api.openDataDir()}>Open data folder</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {user ? (
        <>
          <Header />
          {saveError && (
            <div className="bg-red-600 text-white text-sm px-4 py-2 text-center" role="alert">
              Changes are not being saved to disk ({saveError}). Do not print until this is fixed.
            </div>
          )}
          {recovered && (
            <div className="bg-amber-100 text-amber-900 text-sm px-4 py-2 flex items-center justify-center gap-4" role="alert">
              The last save did not finish, so the previous saved copy was loaded. Check that your most recent entries are in the Register.
              <button className="underline shrink-0" onClick={dismissRecovered}>
                I have checked
              </button>
            </div>
          )}
          <main>
            {tab === 'import' && <ImportTab />}
            {tab === 'held' && <HeldTab />}
            {tab === 'queue' && <QueueTab />}
            {tab === 'register' && <RegisterTab />}
            {tab === 'setup' && <SetupTab />}
          </main>
          {payrollRequest && <PayrollModal key={payrollRequest.filename} request={payrollRequest} />}
        </>
      ) : (
        <LoginScreen />
      )}

      {dragging && (
        <div className="fixed inset-0 z-[60] bg-ncba-teal/90 flex flex-col items-center justify-center text-white pointer-events-none">
          <Upload size={56} />
          <p className="mt-4 text-2xl font-semibold">Drop requisition PDFs to load them</p>
        </div>
      )}

      <div className="fixed bottom-4 left-4 z-[70] space-y-2 w-96 max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`flex items-start gap-3 rounded-lg shadow-lg px-4 py-3 text-sm ${TOAST_STYLE[t.kind]}`}>
            <span className="flex-1">{t.text}</span>
            <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="opacity-80 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  if (!hasDesktopApi) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-gray-600">
        <div>
          <p className="text-lg font-semibold text-gray-800">Cheque Printer runs as a desktop app.</p>
          <p className="text-sm mt-2">Open it from the Cheque Printer shortcut rather than in a web browser.</p>
        </div>
      </div>
    );
  }
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
