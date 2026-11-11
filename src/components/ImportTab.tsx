import { useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, FileText, Loader, MinusCircle, Upload } from 'lucide-react';
import { useApp } from '../state/AppContext';
import type { ImportState } from '../state/importer';
import { Button } from './ui';

const ROW_STYLE: Record<ImportState, { icon: JSX.Element; text: string }> = {
  working: { icon: <Loader size={16} className="text-ncba-teal animate-spin" />, text: 'text-gray-500' },
  queued: { icon: <CheckCircle size={16} className="text-green-600" />, text: 'text-green-800' },
  held: { icon: <AlertTriangle size={16} className="text-amber-500" />, text: 'text-amber-800' },
  skipped: { icon: <MinusCircle size={16} className="text-gray-400" />, text: 'text-gray-600' },
  error: { icon: <AlertCircle size={16} className="text-red-500" />, text: 'text-red-700' },
};

export function ImportTab() {
  const { imports, importFiles, clearImports, held, queue, setTab } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const queued = queue.reduce((n, g) => n + g.cheques.length, 0);
  const finished = imports.some((r) => r.state !== 'working');

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full border-2 border-dashed border-gray-300 bg-white rounded-xl p-14 text-center hover:border-ncba-teal hover:bg-ncba-light transition-colors"
      >
        <span className="flex flex-col items-center gap-4">
          <span className="p-4 rounded-full bg-gray-100">
            <Upload size={32} className="text-gray-500" />
          </span>
          <span>
            <span className="block text-lg font-semibold text-gray-700">Drop signed requisition PDFs here</span>
            <span className="block text-sm text-gray-500 mt-1">or click to choose files. You can drop them anywhere in this window.</span>
            <span className="block text-xs text-gray-400 mt-3">
              Each one is checked for a signature. Signed ones go straight to the print queue; anything else is held.
            </span>
          </span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          importFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      <div className="grid grid-cols-2 gap-3 mt-5">
        <button onClick={() => setTab('queue')} className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-ncba-teal transition-colors">
          <p className="text-2xl font-bold text-ncba-dark" data-testid="queued-count">{queued}</p>
          <p className="text-sm text-gray-600">ready in the print queue</p>
        </button>
        <button onClick={() => setTab('held')} className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-amber-400 transition-colors">
          <p className="text-2xl font-bold text-amber-600" data-testid="held-count">{held.length}</p>
          <p className="text-sm text-gray-600">held — need attention</p>
        </button>
      </div>

      {imports.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-600">Loaded this session</p>
            {finished && (
              <Button small variant="ghost" onClick={clearImports}>
                Clear list
              </Button>
            )}
          </div>
          <ul className="space-y-2" data-testid="import-results">
            {imports.map((row) => (
              <li key={row.id} data-state={row.state} className="flex items-start gap-3 bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100">
                <FileText size={18} className="text-gray-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{row.filename}</p>
                  <p className={`text-xs mt-0.5 ${ROW_STYLE[row.state].text}`}>{row.message}</p>
                </div>
                <span className="shrink-0 mt-0.5">{ROW_STYLE[row.state].icon}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
