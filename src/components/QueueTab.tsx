import { useMemo, useState } from 'react';
import { AlertTriangle, Building2, Eye, Pencil, Printer, Trash2 } from 'lucide-react';
import { formatMoney } from '../core/amount';
import { can } from '../core/auth';
import { formatDate, todayIso } from '../core/dates';
import { getWarnings } from '../core/issues';
import { chequeValues, layoutCheque } from '../core/layout';
import { findMissingNumbers, usedChequeNumbers, type NumberRange, type QueueGroup } from '../core/queue';
import { cancelCheque, cancelCheques } from '../core/store';
import type { Cheque } from '../core/types';
import { measureText } from '../platform/measure';
import { useApp } from '../state/AppContext';
import { ChequePreview } from './ChequePreview';
import { EditChequeModal } from './EditChequeModal';
import { PrintRunModal } from './PrintRunModal';
import { Badge, Button, EmptyState, Modal } from './ui';

const rangeText = (r: { from: string; to: string; count: number }) => (r.count === 1 ? r.from : `${r.from}–${r.to}`);

export function QueueTab() {
  const { queue, store, user, run, notify, setTab, held } = useApp();
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // A snapshot of the run: once the job is sent, its cheques leave the queue but the dialog must stay.
  const [printRun, setPrintRun] = useState<{ group: QueueGroup; cheques: Cheque[]; missing: NumberRange[] } | null>(null);
  const [preview, setPreview] = useState<Cheque | null>(null);
  const [editing, setEditing] = useState<Cheque | null>(null);
  const today = useMemo(() => todayIso(), []);

  if (queue.length === 0 && !printRun) {
    return (
      <EmptyState icon={<Printer size={48} />} title="The print queue is empty.">
        Drop signed requisitions to fill it.
        {held.length > 0 && (
          <>
            {' '}
            <button className="underline text-amber-600" onClick={() => setTab('held')}>
              {held.length} held
            </button>{' '}
            need attention.
          </>
        )}
      </EmptyState>
    );
  }

  function toggle(id: string) {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function discard(cheque: Cheque) {
    if (!window.confirm(`Discard cheque ${cheque.chequeNumber} to ${cheque.payee}? It will not be printed.`)) return;
    if (run((s, ctx) => cancelCheque(s, ctx, cheque.id, 'Discarded from the print queue'))) notify('info', 'Requisition discarded.');
  }

  /** Takes requisitions out of the queue. They stay in the register as discarded and can be dropped in again. */
  function clear(cheques: Cheque[], what: string) {
    const question =
      `Clear ${cheques.length} cheque${cheques.length === 1 ? '' : 's'} from ${what}?\n\n` +
      'They will not be printed. To print one later, drop its requisition PDF in again.';
    if (!window.confirm(question)) return;
    const ids = cheques.map((c) => c.id);
    if (run((s, ctx) => cancelCheques(s, ctx, ids, 'Cleared from the print queue'))) {
      notify('info', `${ids.length} cheque${ids.length === 1 ? '' : 's'} cleared from ${what}.`);
    }
  }

  /** The leaves actually going into this run, and the ones to pull from the stack. */
  function runFor(group: QueueGroup) {
    const cheques = group.cheques.filter((c) => !skipped.has(c.id));
    const missing = findMissingNumbers(
      cheques.map((c) => c.chequeNumber),
      usedChequeNumbers(store, group.company.id)
    );
    return { cheques, missing };
  }

  const previewCompany = preview && store.companies.find((c) => c.id === preview.companyId);

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between gap-4 mb-1">
        <h1 className="text-xl font-bold text-gray-800">Print queue</h1>
        <Button small variant="danger" onClick={() => clear(queue.flatMap((g) => g.cheques), 'the whole print queue')} data-testid="clear-all">
          <Trash2 size={13} /> Clear whole queue
        </Button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        One company at a time. Each list is in the order the cheque leaves must be loaded: lowest number first.
      </p>

      <div className="space-y-6">
        {queue.map((group) => {
          const { cheques, missing } = runFor(group);
          const total = cheques.reduce((sum, c) => sum + c.amountCents, 0);
          return (
            <section key={group.company.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" data-company={group.company.name}>
              <div className="flex items-center justify-between gap-4 px-5 py-4 bg-gray-50 border-b border-gray-100">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 font-semibold text-gray-800">
                    <Building2 size={17} className="text-ncba-teal shrink-0" />
                    <span className="truncate">{group.company.name}</span>
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {cheques.length > 0 ? (
                      <>
                        Load {cheques.length} {cheques.length === 1 ? 'leaf' : 'leaves'}:{' '}
                        <span className="font-mono font-semibold text-gray-700">
                          {cheques[0].chequeNumber}
                          {cheques.length > 1 && ` → ${cheques[cheques.length - 1].chequeNumber}`}
                        </span>
                        {' · '}KES {formatMoney(total)}
                      </>
                    ) : (
                      'Nothing ticked for this run'
                    )}
                    {group.lastPrinted && ` · last used ${group.lastPrinted}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                <Button small variant="ghost" onClick={() => clear(group.cheques, `the ${group.company.name} queue`)} data-testid="clear-company">
                  <Trash2 size={13} /> Clear
                </Button>
                <Button
                  variant="primary"
                  disabled={cheques.length === 0 || !can(user, 'print')}
                  onClick={() => setPrintRun({ group, cheques, missing })}
                  data-testid="print-company"
                >
                  <Printer size={15} /> Print {cheques.length}
                </Button>
                </div>
              </div>

              {missing.length > 0 && (
                <div className="flex items-start gap-2 px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-sm text-amber-900">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-500" />
                  <span>
                    Gap in the numbers: {missing.map(rangeText).join(', ')} {missing.length === 1 && missing[0].count === 1 ? 'is' : 'are'} not in
                    this run. Check for a missing requisition, or take those leaves out before loading.
                  </span>
                </div>
              )}

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="px-5 py-2 w-10"></th>
                    <th className="px-2 py-2 w-28">Cheque no.</th>
                    <th className="px-2 py-2">Payee</th>
                    <th className="px-2 py-2 w-28">Date</th>
                    <th className="px-2 py-2 w-36 text-right">Amount (KES)</th>
                    <th className="px-5 py-2 w-28"></th>
                  </tr>
                </thead>
                <tbody>
                  {group.cheques.map((cheque) => {
                    const included = !skipped.has(cheque.id);
                    const warnings = getWarnings(cheque, today);
                    return (
                      <tr key={cheque.id} data-cheque={cheque.chequeNumber} className={`border-b border-gray-50 last:border-0 ${included ? '' : 'opacity-50'}`}>
                        <td className="px-5 py-3">
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={() => toggle(cheque.id)}
                            aria-label={`Include cheque ${cheque.chequeNumber} in this run`}
                          />
                        </td>
                        <td className="px-2 py-3 font-mono font-semibold text-gray-800">{cheque.chequeNumber}</td>
                        <td className="px-2 py-3 text-gray-800">
                          {cheque.payee}
                          {warnings.length > 0 && (
                            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                              {warnings.map((w) => (
                                <Badge key={w} tone="amber">
                                  {w}
                                </Badge>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-gray-600">{formatDate(cheque.date)}</td>
                        <td className="px-2 py-3 text-right font-mono text-gray-800">{formatMoney(cheque.amountCents)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setPreview(cheque)} className="p-1.5 text-gray-400 hover:text-ncba-teal" title="Preview" aria-label="Preview">
                              <Eye size={15} />
                            </button>
                            {can(user, 'edit_cheque') && (
                              <button onClick={() => setEditing(cheque)} className="p-1.5 text-gray-400 hover:text-ncba-teal" title="Edit" aria-label="Edit">
                                <Pencil size={15} />
                              </button>
                            )}
                            <button onClick={() => discard(cheque)} className="p-1.5 text-gray-400 hover:text-red-500" title="Discard" aria-label="Discard">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>

      {printRun && (
        <PrintRunModal
          company={printRun.group.company}
          cheques={printRun.cheques}
          missing={printRun.missing}
          lastPrinted={printRun.group.lastPrinted}
          onClose={() => setPrintRun(null)}
        />
      )}

      {editing && <EditChequeModal cheque={editing} onClose={() => setEditing(null)} />}

      {preview && previewCompany && (
        <Modal title={`Preview — cheque ${preview.chequeNumber}`} onClose={() => setPreview(null)} wide>
          <p className="text-xs text-gray-500 mb-3">
            Where the text lands on a {previewCompany.name} cheque ({previewCompany.template.chequeWidth} × {previewCompany.template.chequeHeight} mm).
            The cheque's own printed labels are not shown.
          </p>
          <div className="overflow-auto">
            <ChequePreview layout={layoutCheque(chequeValues(preview), previewCompany, measureText)} template={previewCompany.template} />
          </div>
        </Modal>
      )}
    </div>
  );
}
