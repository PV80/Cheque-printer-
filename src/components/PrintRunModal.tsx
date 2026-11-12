import { useState } from 'react';
import { AlertTriangle, Loader, Printer } from 'lucide-react';
import { formatMoney } from '../core/amount';
import { buildPrintHtml, chequeValues, layoutCheque, pageSizeMm } from '../core/layout';
import type { NumberRange } from '../core/queue';
import { assertPrintable, clearSentToPrinter, markSentToPrinter, recordPrintResults, type PrintOutcome } from '../core/store';
import type { Cheque, CompanyProfile } from '../core/types';
import { api } from '../platform/api';
import { measureText } from '../platform/measure';
import { useApp } from '../state/AppContext';
import { Button, inputClass, Modal, Notice } from './ui';

type Outcome = PrintOutcome['outcome'];

const rangeText = (r: NumberRange) => (r.count === 1 ? r.from : `${r.from} to ${r.to} (${r.count} leaves)`);

interface ResultsProps {
  company: CompanyProfile;
  cheques: Cheque[];
  /** What each leaf is assumed to be until the operator says otherwise. */
  initial: Outcome;
  onDone: () => void;
}

/**
 * Records what actually came out of the printer. It cannot be dismissed:
 * leaving a print unrecorded is how a cheque gets printed twice.
 */
export function PrintResultsModal({ company, cheques, initial, onDone }: ResultsProps) {
  const { run, notify } = useApp();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>(() => Object.fromEntries(cheques.map((c) => [c.id, initial])));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [allChecked, setAllChecked] = useState(false);

  function save() {
    const results: PrintOutcome[] = cheques.map((c) => ({ id: c.id, outcome: outcomes[c.id], note: notes[c.id] }));
    if (!run((s, ctx) => recordPrintResults(s, ctx, results))) return;
    const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
    const parts = [`${count('printed')} printed`];
    if (count('spoiled')) parts.push(`${count('spoiled')} spoiled`);
    if (count('not_printed')) parts.push(`${count('not_printed')} still in the queue`);
    notify('success', `${company.name}: ${parts.join(', ')}.`);
    onDone();
  }

  return (
    <Modal
      title={`Check the printed cheques — ${company.name}`}
      footer={
        <Button variant="primary" disabled={!allChecked} onClick={save} data-testid="save-results">
          Save results
        </Button>
      }
    >
      <p className="text-sm text-gray-600 mb-4">
        Compare each leaf with this list, then say what happened. A spoiled leaf's number is retired — the requisition must be
        re-issued with a new cheque number.
      </p>
      <ul className="space-y-2" data-testid="print-results">
        {cheques.map((c) => (
          <li key={c.id} className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <span className="font-mono font-semibold">{c.chequeNumber}</span>
                <span className="mx-2 text-gray-300">|</span>
                <span className="truncate">{c.payee}</span>
                <span className="mx-2 text-gray-300">|</span>
                <span className="font-mono">{formatMoney(c.amountCents)}</span>
              </div>
              <select
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm shrink-0"
                value={outcomes[c.id]}
                onChange={(e) => setOutcomes((o) => ({ ...o, [c.id]: e.target.value as Outcome }))}
                aria-label={`Result for cheque ${c.chequeNumber}`}
                data-testid={`result-${c.chequeNumber}`}
              >
                <option value="printed">Printed correctly</option>
                <option value="spoiled">Spoiled — leaf wasted</option>
                <option value="not_printed">Did not print — leaf unused</option>
              </select>
            </div>
            {outcomes[c.id] === 'spoiled' && (
              <input
                className={`${inputClass} mt-2`}
                placeholder="What went wrong? e.g. paper jam, printed off the line"
                value={notes[c.id] ?? ''}
                onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
              />
            )}
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 mt-4 text-sm text-gray-800">
        <input type="checkbox" checked={allChecked} onChange={(e) => setAllChecked(e.target.checked)} data-testid="results-checked" />
        I have checked every leaf against this list.
      </label>
    </Modal>
  );
}

interface RunProps {
  company: CompanyProfile;
  cheques: Cheque[]; // ascending cheque number
  missing: NumberRange[];
  lastPrinted: string | null;
  onClose: () => void;
}

type Step = { name: 'load' } | { name: 'printing' } | { name: 'results'; initial: Outcome };

/**
 * One company's print run: tells the operator exactly which leaves to load,
 * prints, then records what actually came out of the printer.
 */
export function PrintRunModal({ company, cheques, missing, lastPrinted, onClose }: RunProps) {
  const { run, flushSaves } = useApp();
  const [step, setStep] = useState<Step>({ name: 'load' });
  const [firstLeafChecked, setFirstLeafChecked] = useState(false);
  const [error, setError] = useState('');

  const ids = cheques.map((c) => c.id);
  const total = cheques.reduce((sum, c) => sum + c.amountCents, 0);

  async function print() {
    setError('');
    // Last check against the live data before anything reaches the printer.
    let current: Cheque[] = [];
    const allowed = run((s, ctx) => {
      current = assertPrintable(s, ctx, ids, measureText);
      return s;
    });
    if (!allowed) return;

    const layouts = current.map((c) => layoutCheque(chequeValues(c), company, measureText));
    const html = buildPrintHtml(layouts, company.template, { title: `Cheques — ${company.name}` });

    // Saved to disk first: if the app closes mid-print, these are held, not reprinted.
    if (!run((s, ctx) => markSentToPrinter(s, ctx, ids))) return;
    setStep({ name: 'printing' });

    let reason = '';
    try {
      if (!(await flushSaves())) throw new Error('the data could not be saved to disk');
      const result = await api.print({ html, ...pageSizeMm(company.template), deviceName: company.printerName });
      if (result.ok) {
        setStep({ name: 'results', initial: 'printed' });
        return;
      }
      reason = result.reason === 'cancelled' ? 'Printing was cancelled.' : `The printer reported a problem (${result.reason}).`;
    } catch (err) {
      reason = `Could not print: ${err instanceof Error ? err.message : 'unknown error'}.`;
    }
    run((s, ctx) => clearSentToPrinter(s, ctx, ids, reason));
    setStep({ name: 'load' });
    setError(`${reason} Nothing has been recorded.`);
  }

  if (step.name === 'printing') {
    return (
      <Modal title={`Printing — ${company.name}`}>
        <div className="flex items-center gap-3 text-gray-700 py-6">
          <Loader className="animate-spin" size={20} />
          Sending {cheques.length} cheque{cheques.length === 1 ? '' : 's'} to the printer…
        </div>
      </Modal>
    );
  }

  if (step.name === 'results') {
    return <PrintResultsModal company={company} cheques={cheques} initial={step.initial} onDone={onClose} />;
  }

  return (
    <Modal
      title={`Load cheques — ${company.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!firstLeafChecked} onClick={() => void print()} data-testid="print-now">
            <Printer size={14} /> Print {cheques.length} cheque{cheques.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-ncba-light border border-ncba-teal/30 rounded-lg p-4">
          <p className="text-sm text-ncba-dark">
            Load <strong>{cheques.length}</strong> <strong>{company.name}</strong> cheque {cheques.length === 1 ? 'leaf' : 'leaves'}
            {company.bankAccount ? ` (A/C ${company.bankAccount})` : ''} so they print in this order:
          </p>
          <ol className="mt-3 space-y-1" data-testid="load-order">
            {cheques.map((c, i) => (
              <li key={c.id} className="flex items-baseline gap-3 text-sm">
                <span className="w-6 text-right text-xs text-gray-500">{i + 1}.</span>
                <span className="font-mono font-bold text-gray-900">{c.chequeNumber}</span>
                <span className="text-gray-700 truncate">{c.payee}</span>
                <span className="ml-auto font-mono text-gray-700">{formatMoney(c.amountCents)}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-gray-600 mt-3">
            Lowest number prints first. Total KES {formatMoney(total)}.
            {lastPrinted && ` Last cheque used for this company: ${lastPrinted}.`}
          </p>
          {company.template.rotate180 && (
            <p className="text-sm text-ncba-dark font-medium mt-2" data-testid="load-upside-down">
              These cheques print upside down: load each leaf with its bottom edge going into the printer first.
            </p>
          )}
          {company.loadingNote && <p className="text-sm text-ncba-dark font-medium mt-2">{company.loadingNote}</p>}
        </div>

        {missing.length > 0 && (
          <Notice tone="amber">
            <span className="flex items-start gap-2">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span data-testid="missing-leaves">
                Not in this run — take these leaves <strong>out</strong> of the stack: {missing.map(rangeText).join('; ')}.
              </span>
            </span>
          </Notice>
        )}

        <p className="text-xs text-gray-500">
          Printer: {company.printerName || 'you will choose it in the print window. Keep scaling at 100% / actual size.'}
        </p>

        {error && (
          <Notice tone="red">
            {error}{' '}
            <button className="underline" onClick={() => setStep({ name: 'results', initial: 'not_printed' })}>
              Some cheques did print — record what happened
            </button>
          </Notice>
        )}

        <label className="flex items-center gap-2 text-sm text-gray-800 font-medium">
          <input type="checkbox" checked={firstLeafChecked} onChange={(e) => setFirstLeafChecked(e.target.checked)} data-testid="first-leaf" />
          The first leaf in the printer is cheque {cheques[0]?.chequeNumber}, and the rest follow in the order above.
        </label>
      </div>
    </Modal>
  );
}
