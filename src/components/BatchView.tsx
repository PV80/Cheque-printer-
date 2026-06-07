import { useState } from 'react';
import {
  Building2, CheckSquare, Square, Printer, Pencil, Trash2,
  AlertTriangle, CheckCircle, Clock, FileText
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ChequeData } from '../types';
import { EditChequeModal } from './EditChequeModal';
import { AssignCompanyModal } from './AssignCompanyModal';

const STATUS_ICON: Record<string, React.ReactNode> = {
  ready: <CheckCircle size={14} className="text-green-500" />,
  needs_review: <AlertTriangle size={14} className="text-amber-500" />,
  printed: <Clock size={14} className="text-gray-400" />,
  extracting: <Clock size={14} className="text-blue-400" />,
  error: <AlertTriangle size={14} className="text-red-500" />,
};

export function BatchView() {
  const { state, dispatch, getBatches } = useApp();
  const [editing, setEditing] = useState<ChequeData | null>(null);
  const [assigning, setAssigning] = useState<ChequeData | null>(null);

  const batches = getBatches();

  function toggleQueue(id: string) {
    dispatch({ type: 'TOGGLE_PRINT_QUEUE', id });
  }

  function selectAllInBatch(ids: string[]) {
    const allSelected = ids.every((id) => state.printQueue.includes(id));
    if (allSelected) {
      dispatch({ type: 'SET_PRINT_QUEUE', ids: state.printQueue.filter((id) => !ids.includes(id)) });
    } else {
      dispatch({ type: 'SET_PRINT_QUEUE', ids: [...state.printQueue, ...ids.filter((id) => !state.printQueue.includes(id))] });
    }
  }

  if (batches.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-16 px-4 text-center">
        <FileText size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500 text-lg">No cheques loaded yet.</p>
        <button
          onClick={() => dispatch({ type: 'SET_TAB', tab: 'upload' })}
          className="mt-4 px-6 py-2 bg-ncba-teal text-white rounded-lg text-sm hover:bg-ncba-dark transition-colors"
        >
          Upload PDFs
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-4 md:py-6 px-3 md:px-4">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <h1 className="text-lg md:text-xl font-bold text-gray-800">
          Cheque Batches
          <span className="ml-2 text-sm md:text-base font-normal text-gray-500">
            {state.cheques.length} cheque{state.cheques.length !== 1 ? 's' : ''}
          </span>
        </h1>
        {state.printQueue.length > 0 && (
          <button
            onClick={() => dispatch({ type: 'SET_TAB', tab: 'print' })}
            className="flex items-center gap-1.5 px-3 py-2 bg-ncba-teal text-white text-sm rounded-lg hover:bg-ncba-dark transition-colors"
          >
            <Printer size={14} />
            <span className="hidden sm:inline">Print</span> {state.printQueue.length}
          </button>
        )}
      </div>

      <div className="space-y-4 md:space-y-6">
        {batches.map((batch) => {
          const batchIds = batch.cheques.map((c) => c.id);
          const allSelected = batchIds.every((id) => state.printQueue.includes(id));
          const someSelected = batchIds.some((id) => state.printQueue.includes(id));
          const needsSetup = !batch.companyId;

          return (
            <div
              key={batch.companyId || batch.companyName}
              className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
            >
              {/* Company header */}
              <div className={`flex items-center justify-between px-3 md:px-5 py-3 ${needsSetup ? 'bg-amber-50 border-b border-amber-100' : 'bg-gray-50 border-b border-gray-100'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <button onClick={() => selectAllInBatch(batchIds)} className="shrink-0">
                    {allSelected
                      ? <CheckSquare size={18} className="text-ncba-teal" />
                      : someSelected
                      ? <CheckSquare size={18} className="text-ncba-teal/50" />
                      : <Square size={18} className="text-gray-400" />}
                  </button>
                  <Building2 size={16} className={`shrink-0 ${needsSetup ? 'text-amber-500' : 'text-ncba-teal'}`} />
                  <span className="font-semibold text-gray-800 text-sm md:text-base truncate">{batch.companyName}</span>
                  <span className="hidden sm:inline text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full shrink-0">
                    {batch.cheques.length}
                  </span>
                </div>
                {needsSetup && (
                  <button
                    onClick={() => setAssigning(batch.cheques[0])}
                    className="text-xs text-amber-700 border border-amber-300 px-2 py-1 rounded-lg hover:bg-amber-100 transition-colors shrink-0 ml-2"
                  >
                    Set up
                  </button>
                )}
              </div>

              {/* Desktop: table view */}
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="px-4 py-2 w-8"></th>
                      <th className="px-4 py-2 w-20">CHQ #</th>
                      <th className="px-4 py-2">Payee</th>
                      <th className="px-4 py-2 w-28">Date</th>
                      <th className="px-4 py-2 w-32 text-right">Amount (KES)</th>
                      <th className="px-4 py-2 w-8"></th>
                      <th className="px-4 py-2 w-16 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batch.cheques.map((cheque) => {
                      const inQueue = state.printQueue.includes(cheque.id);
                      return (
                        <tr key={cheque.id} className={`border-b border-gray-50 last:border-0 transition-colors ${inQueue ? 'bg-ncba-light/40' : 'hover:bg-gray-50'}`}>
                          <td className="px-4 py-3">
                            <button onClick={() => toggleQueue(cheque.id)}>
                              {inQueue
                                ? <CheckSquare size={16} className="text-ncba-teal" />
                                : <Square size={16} className="text-gray-300 hover:text-gray-500" />}
                            </button>
                          </td>
                          <td className="px-4 py-3 font-mono font-medium text-gray-700">{cheque.chequeNumber || '—'}</td>
                          <td className="px-4 py-3 text-gray-800 font-medium">{cheque.payee || <span className="text-gray-400 italic">Not detected</span>}</td>
                          <td className="px-4 py-3 text-gray-600">{cheque.date || '—'}</td>
                          <td className="px-4 py-3 text-right font-mono text-gray-800">
                            {cheque.amountFigures > 0 ? cheque.amountFigures.toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-3">{STATUS_ICON[cheque.status]}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <button onClick={() => setEditing(cheque)} className="text-gray-400 hover:text-ncba-teal transition-colors"><Pencil size={14} /></button>
                              <button onClick={() => dispatch({ type: 'REMOVE_CHEQUE', id: cheque.id })} className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile: card list */}
              <div className="md:hidden divide-y divide-gray-100">
                {batch.cheques.map((cheque) => {
                  const inQueue = state.printQueue.includes(cheque.id);
                  return (
                    <div key={cheque.id} className={`flex items-start gap-3 px-3 py-3 transition-colors ${inQueue ? 'bg-ncba-light/40' : ''}`}>
                      <button onClick={() => toggleQueue(cheque.id)} className="mt-0.5 shrink-0">
                        {inQueue
                          ? <CheckSquare size={18} className="text-ncba-teal" />
                          : <Square size={18} className="text-gray-300" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-xs font-bold text-gray-500">CHQ #{cheque.chequeNumber || '?'}</span>
                          {STATUS_ICON[cheque.status]}
                          {cheque.status === 'needs_review' && (
                            <span className="text-xs text-amber-600">Review needed</span>
                          )}
                        </div>
                        <p className="font-semibold text-gray-800 truncate text-sm">
                          {cheque.payee || <span className="text-gray-400 italic">No payee</span>}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-gray-500">{cheque.date || '—'}</span>
                          <span className="text-xs font-mono text-gray-700 font-medium">
                            KES {cheque.amountFigures > 0 ? cheque.amountFigures.toLocaleString() : '—'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <button onClick={() => setEditing(cheque)} className="text-gray-400 hover:text-ncba-teal p-1"><Pencil size={15} /></button>
                        <button onClick={() => dispatch({ type: 'REMOVE_CHEQUE', id: cheque.id })} className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {editing && <EditChequeModal cheque={editing} onClose={() => setEditing(null)} />}
      {assigning && <AssignCompanyModal cheque={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}
