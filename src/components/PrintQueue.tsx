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
    openPrintWindow(
      [cheque],
      company.template,
      company.printerType || 'laser',
      company.printerOffsetX ?? 0,
      company.printerOffsetY ?? 0
    );
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
      openPrintWindow(
        cheques,
        company.template,
        company.printerType || 'laser',
        company.printerOffsetX ?? 0,
        company.printerOffsetY ?? 0
      );
    }
    setTimeout(
      () =>
        dispatch({
          type: 'MARK_PRINTED',
          ids: sorted.filter((c) => !!c.companyId).map((c) => c.id),
        }),
      1500
    );
  }

  function openPrintWindow(
    cheques: ChequeData[],
    template: ChequeTemplate,
    printerType: string,
    offsetX: number,
    offsetY: number
  ) {
    const win = window.open('', '_blank');
    if (!win) return;

    const t = template;
    const pageH = t.chequeHeight + t.pageTopOffset;
    const pages = cheques
      .map((cheque) => buildChequePage(cheque, t, printerType, offsetX, offsetY))
      .join('\n');

    win.document.write(`<!DOCTYPE html>
<html><head>
<title>Cheque Print</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page {
    size: ${t.chequeWidth}mm ${pageH}mm;
    margin: 0;
  }
  .cheque-page {
    position: relative;
    width: ${t.chequeWidth}mm;
    height: ${pageH}mm;
    page-break-after: always;
  }
  .cheque-page:last-child { page-break-after: avoid; }
  .field { position: absolute; }
  .field-nowrap { white-space: nowrap; overflow: hidden; }
  .field-wrap { white-space: normal; overflow: visible; word-wrap: break-word; }
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
    <div className="max-w-4xl mx-auto py-4 md:py-6 px-3 md:px-4">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <h1 className="text-lg md:text-xl font-bold text-gray-800">
          Print Queue
          <span className="ml-2 text-sm md:text-base font-normal text-gray-500">
            {sorted.length} cheque{sorted.length !== 1 ? 's' : ''}
          </span>
        </h1>
        <button
          onClick={printAll}
          disabled={noProfile.length === sorted.length}
          className="flex items-center gap-1.5 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 bg-ncba-teal text-white rounded-lg hover:bg-ncba-dark disabled:opacity-50 transition-colors font-medium text-sm md:text-base"
        >
          <Printer size={16} />
          <span className="hidden sm:inline">Print All</span>
          <span className="sm:hidden">Print</span>
          {' '}({sorted.filter((c) => !!c.companyId).length})
        </button>
      </div>

      {noProfile.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-sm text-amber-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{noProfile.length} cheque{noProfile.length !== 1 ? 's' : ''} have no company profile — set up in Companies tab first.</span>
        </div>
      )}

      {needsReview.length > 0 && (
        <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-start gap-2 text-sm text-orange-800">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>{needsReview.length} cheque{needsReview.length !== 1 ? 's' : ''} flagged for review — verify before printing.</span>
        </div>
      )}

      <div className="space-y-2">
        {sorted.map((cheque, i) => {
          const company = state.companies.find((c) => c.id === cheque.companyId);
          const hasProfile = !!company;

          return (
            <div
              key={cheque.id}
              className={`bg-white rounded-xl border px-3 md:px-5 py-3 md:py-4 ${
                hasProfile ? 'border-gray-200' : 'border-amber-200 bg-amber-50/30'
              }`}
            >
              {/* Mobile layout */}
              <div className="flex items-start gap-3 md:hidden">
                <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-xs font-bold text-gray-500">CHQ #{cheque.chequeNumber}</span>
                    {cheque.status === 'needs_review' && <AlertTriangle size={13} className="text-amber-500" />}
                    {cheque.status === 'printed' && <CheckCircle size={13} className="text-green-500" />}
                  </div>
                  <p className="font-semibold text-gray-800 truncate text-sm">{cheque.payee}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-gray-500">{cheque.date}</span>
                    <span className="text-xs font-mono font-medium text-gray-700">
                      KES {cheque.amountFigures.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5">
                    {company ? <span className="text-gray-500">{company.name}</span> : <span className="text-amber-600">No company profile</span>}
                  </p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => setPreviewing(cheque)} className="p-1.5 text-gray-400 hover:text-ncba-teal"><Eye size={15} /></button>
                  {hasProfile && (
                    <button onClick={() => printSingle(cheque)} className="p-1.5 text-ncba-teal"><Printer size={15} /></button>
                  )}
                  <button onClick={() => dispatch({ type: 'TOGGLE_PRINT_QUEUE', id: cheque.id })} className="p-1.5 text-gray-400 hover:text-red-500"><X size={15} /></button>
                </div>
              </div>

              {/* Desktop layout */}
              <div className="hidden md:flex items-center gap-4">
                <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">
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
                    <p className="text-sm text-gray-800">KES {cheque.amountFigures.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Company</p>
                    <p className="text-sm truncate">
                      {company ? <span className="text-gray-800">{company.name}</span> : <span className="text-amber-600">No profile</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {cheque.status === 'needs_review' && <AlertTriangle size={16} className="text-amber-500" />}
                  {cheque.status === 'printed' && <CheckCircle size={16} className="text-green-500" />}
                  <button onClick={() => setPreviewing(cheque)} className="p-2 text-gray-400 hover:text-ncba-teal transition-colors"><Eye size={16} /></button>
                  {hasProfile && (
                    <button onClick={() => printSingle(cheque)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-ncba-teal text-ncba-teal rounded-lg hover:bg-ncba-light transition-colors">
                      <Printer size={12} />
                      Print
                    </button>
                  )}
                  <button onClick={() => dispatch({ type: 'TOGGLE_PRINT_QUEUE', id: cheque.id })} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><X size={16} /></button>
                </div>
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

function buildChequePage(
  cheque: ChequeData,
  t: ChequeTemplate,
  printerType: string,
  offsetX: number,
  offsetY: number
): string {
  const topOffset = t.pageTopOffset;
  const fontStack =
    printerType === 'dot_matrix' ? "'Courier New',monospace" : "'Arial',sans-serif";

  const fieldHtml = (fieldKey: keyof ChequeTemplate['fields'], value: string) => {
    const p = t.fields[fieldKey];
    if (!p) return '';
    const wrapCls = p.wrap ? 'field-wrap' : 'field-nowrap';
    const heightStyle = p.wrap && p.height ? `height:${p.height}mm;` : '';
    return `<div class="field ${wrapCls}" style="
      left:${p.x + offsetX}mm;
      top:${p.y + topOffset + offsetY}mm;
      width:${p.width}mm;
      ${heightStyle}
      font-family:${fontStack};
      font-size:${p.fontSize}pt;
      font-weight:${p.fontWeight};
      text-align:${p.align};
    ">${escapeHtml(value)}</div>`;
  };

  return `<div class="cheque-page">
    ${fieldHtml('date', cheque.date)}
    ${fieldHtml('payee', cheque.payee)}
    ${fieldHtml('amountFigures', formatAmount(cheque.amountFigures))}
    ${fieldHtml('amountWords', cheque.amountWords)}
  </div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Kenyan cheque standard: comma-separated with /= suffix, no decimal places
function formatAmount(n: number): string {
  return n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + '/=';
}
