import { useState } from 'react';
import { AlertTriangle, Users } from 'lucide-react';
import { formatMoney } from '../core/amount';
import { isValidIsoDate, todayIso } from '../core/dates';
import { chequeNumberAfter } from '../core/payroll';
import { nextChequeNumber } from '../core/queue';
import { payrollNumberProblems } from '../core/store';
import { useApp } from '../state/AppContext';
import type { PayrollRequest } from '../state/importer';
import { Button, Field, inputClass, Modal } from './ui';

interface Row {
  checked: boolean;
  number: string;
}

/** Gives the ticked rows from `from` onwards consecutive cheque numbers starting at `start`. */
function sequence(rows: Row[], from: number, start: string): Row[] {
  let step = 0;
  return rows.map((row, i) => {
    if (i < from) return row;
    return row.checked ? { ...row, number: chequeNumberAfter(start, step++) } : { ...row, number: '' };
  });
}

/**
 * A payroll PDF holds a salary slip for each employee and no cheque numbers.
 * This asks which cheque book and date to use and which leaf each employee
 * gets; one cheque is then made per ticked slip.
 */
export function PayrollModal({ request }: { request: PayrollRequest }) {
  const { store, answerPayroll } = useApp();
  const slips = request.slips;
  const canLoad = (i: number) => !slips[i].loadedAs && slips[i].amountCents > 0;

  const [companyId, setCompanyId] = useState(request.suggestedCompanyId ?? '');
  const [date, setDate] = useState(todayIso());
  const [first, setFirst] = useState(() => {
    const own = slips.find((slip, i) => canLoad(i) && slip.chequeNumber)?.chequeNumber;
    return own ?? (request.suggestedCompanyId ? nextChequeNumber(store, request.suggestedCompanyId) : '');
  });
  const [rows, setRows] = useState<Row[]>(() => {
    const ticked = slips.map((_, i) => ({ checked: canLoad(i), number: '' }));
    // Slips that name their own cheque number keep it; otherwise number them in order.
    return slips.some((slip) => slip.chequeNumber)
      ? ticked.map((row, i) => (row.checked ? { ...row, number: slips[i].chequeNumber } : row))
      : sequence(ticked, 0, first);
  });

  const company = store.companies.find((c) => c.id === companyId);
  const chosen = rows.flatMap((row, i) => (row.checked ? [{ i, slip: slips[i], number: row.number.trim() }] : []));
  const problems = payrollNumberProblems(
    store,
    companyId,
    chosen.map((c) => ({ payee: c.slip.payee, amountCents: c.slip.amountCents, chequeNumber: c.number }))
  );
  const problemAt = new Map(chosen.map((c, k) => [c.i, problems[k]]));
  const total = chosen.reduce((sum, c) => sum + c.slip.amountCents, 0);
  const ready = company !== undefined && isValidIsoDate(date) && chosen.length > 0 && problems.every((p) => p === '');

  function changeFirst(value: string) {
    setFirst(value);
    setRows((current) => sequence(current, 0, value.trim()));
  }

  function changeCompany(id: string) {
    setCompanyId(id);
    // Offer the next leaf of that cheque book, unless a number was already typed.
    if (first.trim() === '' && id) {
      const next = nextChequeNumber(store, id);
      if (next) changeFirst(next);
    }
  }

  /** The number the row at `i` should take so that it follows the ticked row before it. */
  function numberFollowing(current: Row[], i: number): string {
    for (let j = i - 1; j >= 0; j--) {
      if (current[j].checked) return chequeNumberAfter(current[j].number.trim(), 1);
    }
    return first.trim();
  }

  function changeNumber(i: number, value: string) {
    setRows((current) => {
      const edited = current.map((row, j) => (j === i ? { ...row, number: value } : row));
      // The rows below follow on from the number just typed.
      return sequence(edited, i + 1, chequeNumberAfter(value.trim(), 1));
    });
    if (!rows.slice(0, i).some((row) => row.checked)) setFirst(value);
  }

  function toggle(i: number) {
    setRows((current) => {
      const toggled = current.map((row, j) => (j === i ? { ...row, checked: !row.checked } : row));
      return sequence(toggled, i, numberFollowing(toggled, i));
    });
  }

  function toggleAll(checked: boolean) {
    setRows((current) => sequence(current.map((row, i) => ({ ...row, checked: checked && canLoad(i) })), 0, first.trim()));
  }

  function load() {
    if (!ready) return;
    answerPayroll({ companyId, date, numbers: Object.fromEntries(chosen.map((c) => [c.slip.pages.from, c.number])) });
  }

  const loadable = slips.filter((_, i) => canLoad(i)).length;
  const allTicked = loadable > 0 && chosen.length === loadable;

  return (
    <Modal
      title={`Payroll — ${request.period}`}
      onClose={() => answerPayroll(null)}
      wide
      footer={
        <>
          <span className="mr-auto self-center text-sm text-gray-600" data-testid="payroll-total">
            {chosen.length} {chosen.length === 1 ? 'cheque' : 'cheques'}, total KES {formatMoney(total)}
          </span>
          <Button onClick={() => answerPayroll(null)} data-testid="payroll-cancel">
            Cancel
          </Button>
          <Button variant="primary" disabled={!ready} onClick={load} data-testid="payroll-load">
            Load {chosen.length} {chosen.length === 1 ? 'cheque' : 'cheques'}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="payroll">
        <p className="flex items-start gap-2 text-sm text-gray-600">
          <Users size={16} className="mt-0.5 shrink-0 text-ncba-teal" />
          <span>
            <strong>{request.filename}</strong> holds {slips.length} salary {slips.length === 1 ? 'slip' : 'slips'}
            {request.companyRaw && ` from ${request.companyRaw}`}. One cheque is made for each employee ticked below. Salary slips carry no cheque
            numbers, so give the first leaf and the date: the rest follow in order.
          </span>
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="payroll-company" className="block text-xs font-medium text-gray-600 mb-1">
              Cheque book (company)
            </label>
            <select id="payroll-company" className={inputClass} value={companyId} onChange={(e) => changeCompany(e.target.value)} data-testid="payroll-company">
              <option value="">Choose…</option>
              {store.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <Field label="Date on the cheques" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="payroll-date" />
          <Field
            label="First cheque number"
            value={first}
            onChange={(e) => changeFirst(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 000672"
            hint="The number on the first leaf you will load"
            data-testid="payroll-first"
          />
        </div>

        {store.companies.length === 0 && (
          <p className="text-sm text-red-700">No company has been set up yet. Add it first in Setup → Companies, then drop the payroll again.</p>
        )}
        {company && !company.signatureZones.salary_slip?.length && (
          <p className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {company.name} has no signature box for salary slips yet. The cheques will wait in Held until an administrator sets it there, once for all
            of them.
          </p>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b">
              <th className="py-2 pr-2 w-8">
                <input type="checkbox" checked={allTicked} onChange={(e) => toggleAll(e.target.checked)} aria-label="Tick every employee" data-testid="payroll-tick-all" />
              </th>
              <th className="py-2 pr-3">Employee</th>
              <th className="py-2 pr-3 text-right">Net pay (KES)</th>
              <th className="py-2 pr-3 w-40">Cheque number</th>
              <th className="py-2">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {slips.map((slip, i) => {
              const row = rows[i];
              const problem = row.checked ? problemAt.get(i) : '';
              const note = slip.loadedAs
                ? `Already loaded as ${slip.loadedAs}`
                : slip.amountCents <= 0
                  ? 'Nothing to pay on this slip'
                  : problem || slip.reviewNotes.join(' ');
              return (
                <tr key={slip.pages.from} className="border-b last:border-0" data-testid="payroll-row" data-payee={slip.payee}>
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" checked={row.checked} disabled={!canLoad(i)} onChange={() => toggle(i)} aria-label={`Make a cheque for ${slip.payee}`} data-testid="payroll-tick" />
                  </td>
                  <td className={`py-1.5 pr-3 ${row.checked ? 'text-gray-800' : 'text-gray-400'}`}>{slip.payee}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${row.checked ? 'text-gray-800' : 'text-gray-400'}`}>{formatMoney(slip.amountCents)}</td>
                  <td className="py-1.5 pr-3">
                    <input
                      className={`${inputClass} py-1 ${problem ? 'border-red-400' : ''}`}
                      value={row.number}
                      disabled={!row.checked}
                      onChange={(e) => changeNumber(i, e.target.value)}
                      inputMode="numeric"
                      aria-label={`Cheque number for ${slip.payee}`}
                      data-testid="payroll-number"
                    />
                  </td>
                  <td className={`py-1.5 text-xs ${problem ? 'text-red-700' : slip.reviewNotes.length && !slip.loadedAs ? 'text-amber-700' : 'text-gray-500'}`}>{note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-gray-400">
          Untick anyone who is not paid by cheque. Change any number and the ones below follow on from it. Each slip's signature is checked when the
          cheques are loaded.
        </p>
      </div>
    </Modal>
  );
}
