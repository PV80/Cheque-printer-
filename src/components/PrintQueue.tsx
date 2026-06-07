import { useState } from 'react';
import { Printer, Eye, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ChequeData, ChequeTemplate } from '../types';
import { PrintPreview } from './PrintPreview';

export function PrintQueue() {
  const { state, dispatch } = useApp();
  const [previewing, setPreviewing] = useState<ChequeData | null>(null);

  const queued = state.cheques.filter((c) => state.printQueue.includes(c.id));
  const sorted = [...queued].sort((a, b) => {
    const na = parseInt(a.chequeNumber) || 0;
    const nb = parseInt(b.chequeNumber) || 0;
    return na - nb;
  });

  const noProfile = sorted.filter((c) => !c.companyId);
  const needsReview = sorted.filter((c) => c.status === 'needs_review');

  function printSingle(cheque: ChequeData) {
    const company = state.companies.find((c) => c.id === cheque.companyId);
    if (!company) {
      alert('No company profile for this cheque. Set up the company first.');
      return;
    }
    openPrintWindow([cheque], company.template);
    setTimeout(() => dispatch({ type: 'MARK_PRINTED', ids: [cheque.id] }), 1500);
  }

  function printAll() {
    const byCompany = new Map<string, ChequeData[]>();
    for (const cheque of sorted) {
      if (!cheque.companyId) continue;
      if (!byCompany.has(cheque.companyId)) byCompany.set(cheque.companyId, []);
      byCompany.get(cheque.companyId)!.push(cheque);
    }

    for (const [companyId, cheques] of byCompany) {
      const company = state.companies.find((c) => c.id === companyId);
      if (!company) continue;
      openPrintWindow(cheques, company.template);
    }
    setTimeout(
      () => dispatch({ type: 'MARK_PRINTED', ids: sorted.filter((c) => !!c.companyId).map((c) => c.id) }),
      1500
    );
  }

  function openPrintWindow(cheques: ChequeData[], template: ChequeTemplate) {
    const win = window.open('', '_blank');
    if (!win) return;

    const t = template;
    const pages = cheques
      .map((cheque) => buildChequePage(cheque, t))
      .join('\n');

    win.document.write(`<!DOCTYPE html>
<html><head>
<title>Cheque Print</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page {
    size: ${t.chequeWidth}mm ${t.chequeHeight + t.pageTopOffset}mm;
    margin: 0;
  }
  .cheque-page {
    position: relative;
    width: ${t.chequeWidth}mm;
    height: ${t.chequeHeight + t.pageTopOffset}mm;
    page-break-after: always;
  }
  .cheque-page:last-child { page-break-after: avoid; }
  .field {
    position: absolute;
    white-space: nowrap;
    overflow: hidden;
  }
</style>
</head><body>${pages}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
  }

  if (queued.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-16 px-4 text-center">
        <Printer size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500 text-lg">Print queue is empty.</p>
        <p className="text-sm text-gray-400 mt-1">
          Go to Batches, tick the cheques you want to print, then come back here.
        </p>
        <button
          onClick={() => dispatch({ type: 'SET_TAB', tab: 'batches' })}
          className="mt-4 px-6 py-2 bg-ncba-teal text-white rounded-lg text-sm hover:bg-ncba-dark transition-colors"
        >
          Go to Batches
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-800">
          Print Queue
          <span className="ml-2 text-base font-normal text-gray-500">
            {sorted.length} cheque{sorted.length !== 1 ? 's' : ''}
          </span>
        </h1>
        <button
          onClick={printAll}
          disabled={noProfile.length === sorted.length}
          className="flex items-center gap-2 px-5 py-2.5 bg-ncba-teal text-white rounded-lg hover:bg-ncba-dark disabled:opacity-50 transition-colors font-medium"
        >
          <Printer size={16} />
          Print All ({sorted.filter((c) => !!c.companyId).length})
        </button>
      </div>

      {noProfile.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3 text-sm text-amber-800">
          <AlertTriangle size={16} />
          {noProfile.length} cheque{noProfile.length !== 1 ? 's' : ''} have no company profile — set up in Companies tab before printing.
        </div>
      )}

      {needsReview.length > 0 && (
        <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-center gap-3 text-sm text-orange-800">
          <AlertTriangle size={16} />
          {needsReview.length} cheque{needsReview.length !== 1 ? 's' : ''} flagged for review — verify extracted data before printing.
        </div>
      )}

      <div className="space-y-2">
        {sorted.map((cheque, i) => {
          const company = state.companies.find((c) => c.id === cheque.companyId);
          const hasProfile = !!company;

          return (
            <div
              key={cheque.id}
              className={`bg-white rounded-xl border px-5 py-4 flex items-center gap-4 ${
                hasProfile ? 'border-gray-200' : 'border-amber-200 bg-amber-50/30'
              }`}
            >
              <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                {i + 1}
              </span>

              <div className="flex-1 grid grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-gray-400">CHQ #</p>
                  <p className="font-mono font-semibold text-gray-800">{cheque.chequeNumber}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Payee</p>
                  <p className="text-sm text-gray-800 truncate">{cheque.payee}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Amount</p>
                  <p className="text-sm text-gray-800">
                    KES {cheque.amountFigures.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Company</p>
                  <p className="text-sm truncate">
                    {company ? (
                      <span className="text-gray-800">{company.name}</span>
                    ) : (
                      <span className="text-amber-600">No profile</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {cheque.status === 'needs_review' && (
                  <span title="Needs review"><AlertTriangle size={16} className="text-amber-500" /></span>
                )}
                {cheque.status === 'printed' && (
                  <span title="Already printed"><CheckCircle size={16} className="text-green-500" /></span>
                )}

                <button
                  onClick={() => setPreviewing(cheque)}
                  className="p-2 text-gray-400 hover:text-ncba-teal transition-colors"
                  title="Preview"
                >
                  <Eye size={16} />
                </button>

                {hasProfile && (
                  <button
                    onClick={() => printSingle(cheque)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-ncba-teal text-ncba-teal rounded-lg hover:bg-ncba-light transition-colors"
                  >
                    <Printer size={12} />
                    Print
                  </button>
                )}

                <button
                  onClick={() => dispatch({ type: 'TOGGLE_PRINT_QUEUE', id: cheque.id })}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                  title="Remove from queue"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {previewing && (
        <PrintPreview cheque={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  );
}

function buildChequePage(cheque: ChequeData, t: ChequeTemplate): string {
  const offset = t.pageTopOffset;

  const fieldHtml = (fieldKey: keyof ChequeTemplate['fields'], value: string) => {
    const pos = t.fields[fieldKey];
    if (!pos) return '';
    return `<div class="field" style="
      left:${pos.x}mm;
      top:${pos.y + offset}mm;
      width:${pos.width}mm;
      font-family:'${pos.fontFamily}',sans-serif;
      font-size:${pos.fontSize}pt;
      font-weight:${pos.fontWeight};
      text-align:${pos.align};
    ">${escapeHtml(value)}</div>`;
  };

  return `<div class="cheque-page">
    ${fieldHtml('date', cheque.date)}
    ${fieldHtml('payee', cheque.payee)}
    ${fieldHtml('amountWords', cheque.amountWords)}
    ${fieldHtml('amountFigures', formatAmount(cheque.amountFigures))}
  </div>`;

}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatAmount(n: number): string {
  return n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
