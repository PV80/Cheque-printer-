import { useRef, useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { extractTextFromPdf } from '../lib/pdfExtractor';
import { parsePdfPages } from '../lib/fieldParser';
import { matchCompany } from '../lib/storage';

interface FileEntry {
  name: string;
  state: 'processing' | 'done' | 'error';
  error?: string;
}

export function UploadZone() {
  const { state, dispatch } = useApp();
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function processFile(file: File) {
    setFiles((prev) => [...prev, { name: file.name, state: 'processing' }]);
    try {
      const pages = await extractTextFromPdf(file);
      const cheque = parsePdfPages(pages, file.name);

      // Try to match to an existing company
      const match = matchCompany(cheque.companyRaw, state.companies);
      const withCompany = match ? { ...cheque, companyId: match.id } : cheque;

      dispatch({ type: 'ADD_CHEQUE', cheque: withCompany });
      setFiles((prev) =>
        prev.map((f) => (f.name === file.name ? { ...f, state: 'done' } : f))
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to read PDF';
      setFiles((prev) =>
        prev.map((f) => (f.name === file.name ? { ...f, state: 'error', error: msg } : f))
      );
    }
  }

  async function handleFiles(fileList: FileList) {
    const pdfs = Array.from(fileList).filter((f) => f.type === 'application/pdf');
    await Promise.all(pdfs.map(processFile));
    if (state.cheques.length > 0 || pdfs.length > 0) {
      setTimeout(() => dispatch({ type: 'SET_TAB', tab: 'batches' }), 800);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  const uploading = files.some((f) => f.state === 'processing');

  return (
    <div className="max-w-2xl mx-auto py-6 md:py-10 px-3 md:px-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 md:p-16 text-center cursor-pointer transition-all ${
          dragging
            ? 'border-ncba-teal bg-ncba-light scale-[1.01]'
            : 'border-gray-300 bg-gray-50 hover:border-ncba-teal hover:bg-ncba-light'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <div className="flex flex-col items-center gap-4">
          <div className={`p-4 rounded-full ${dragging ? 'bg-ncba-teal' : 'bg-gray-200'} transition-colors`}>
            <Upload size={32} className={dragging ? 'text-white' : 'text-gray-500'} />
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-700">
              {dragging ? 'Drop PDFs here' : 'Upload cheque requisitions'}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Drag & drop multiple PDFs or click to browse
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Supports: Cheque Requisition Vouchers & ERP Payment Receipts
            </p>
          </div>
        </div>
      </div>

      {files.length > 0 && (
        <div className="mt-6 space-y-2">
          <p className="text-sm font-medium text-gray-600">Processing files</p>
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-3 bg-white rounded-lg px-4 py-3 shadow-sm border border-gray-100"
            >
              <FileText size={18} className="text-gray-400 shrink-0" />
              <span className="flex-1 text-sm text-gray-700 truncate">{f.name}</span>
              {f.state === 'processing' && (
                <Loader size={16} className="text-ncba-teal animate-spin shrink-0" />
              )}
              {f.state === 'done' && (
                <CheckCircle size={16} className="text-green-500 shrink-0" />
              )}
              {f.state === 'error' && (
                <div className="flex items-center gap-1 text-red-500">
                  <AlertCircle size={16} />
                  <span className="text-xs">{f.error}</span>
                </div>
              )}
            </div>
          ))}

          {!uploading && (
            <button
              onClick={() => {
                setFiles([]);
                dispatch({ type: 'SET_TAB', tab: 'batches' });
              }}
              className="mt-2 w-full py-2 text-sm text-ncba-teal font-medium border border-ncba-teal rounded-lg hover:bg-ncba-light transition-colors"
            >
              View Batches →
            </button>
          )}
        </div>
      )}

      {state.cheques.length > 0 && (
        <div className="mt-6 p-4 bg-ncba-light border border-ncba-teal/30 rounded-lg">
          <p className="text-sm text-ncba-dark font-medium">
            {state.cheques.length} cheque{state.cheques.length !== 1 ? 's' : ''} loaded
            {' — '}
            <button
              onClick={() => dispatch({ type: 'SET_TAB', tab: 'batches' })}
              className="underline"
            >
              view batches
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
