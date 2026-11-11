import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Search } from 'lucide-react';
import { formatMoney } from '../core/amount';
import { can } from '../core/auth';
import { formatDate, formatTimestamp, todayIso } from '../core/dates';
import { activityCsv, registerCsv, signatureSummary } from '../core/register';
import { logEvent, markSpoiled, revertPrinted } from '../core/store';
import type { Cheque, ChequeStatus } from '../core/types';
import { api } from '../platform/api';
import { useApp } from '../state/AppContext';
import { Badge, Button, inputClass } from './ui';

const STATUS: Record<ChequeStatus, { label: string; tone: 'green' | 'red' | 'gray' | 'blue' }> = {
  printed: { label: 'Printed', tone: 'green' },
  spoiled: { label: 'Spoiled', tone: 'red' },
  cancelled: { label: 'Discarded', tone: 'gray' },
  pending: { label: 'Not printed', tone: 'blue' },
};

const MAX_ROWS = 300;
const stamp = formatTimestamp;

export function RegisterTab() {
  const { store, run, notify } = useApp();
  const [view, setView] = useState<'cheques' | 'activity'>('cheques');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState<ChequeStatus | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);

  const companyName = useMemo(() => new Map(store.companies.map((c) => [c.id, c.name])), [store.companies]);
  const nameOf = (c: Cheque) => (c.companyId && companyName.get(c.companyId)) || c.companyRaw || 'Unknown company';

  const needle = search.trim().toLowerCase();
  const cheques = useMemo(
    () =>
      store.cheques
        .filter((c) => !companyId || c.companyId === companyId)
        .filter((c) => !status || c.status === status)
        .filter((c) => !needle || `${c.chequeNumber} ${c.payee} ${c.requisitions.map((r) => r.filename).join(' ')}`.toLowerCase().includes(needle))
        .sort((a, b) => (b.printedAt ?? b.createdAt).localeCompare(a.printedAt ?? a.createdAt)),
    [store.cheques, companyId, status, needle]
  );

  const activity = useMemo(
    () => store.audit.filter((a) => !needle || `${a.userName} ${a.action} ${a.details}`.toLowerCase().includes(needle)).reverse(),
    [store.audit, needle]
  );

  async function exportCsv(kind: 'register' | 'activity') {
    const content = kind === 'register' ? registerCsv(store) : activityCsv(store);
    const result = await api.saveFile({ defaultName: `cheque-${kind}-${todayIso()}.csv`, content, kind: 'csv' });
    if (result.saved) {
      run((s, ctx) => logEvent(s, ctx, `Exported ${kind}`, result.path ?? ''));
      notify('success', `Saved to ${result.path}`);
    }
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Register</h1>
          <p className="text-sm text-gray-500">Every requisition loaded and what became of it.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void exportCsv('register')} data-testid="export-register">
            <Download size={14} /> Export cheques (CSV)
          </Button>
          <Button onClick={() => void exportCsv('activity')}>
            <Download size={14} /> Export activity (CSV)
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          {(['cheques', 'activity'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} data-view={v} className={`px-4 py-2 ${view === v ? 'bg-ncba-dark text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
              {v === 'cheques' ? 'Cheques' : 'Activity log'}
            </button>
          ))}
        </div>
        <label className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className={`${inputClass} pl-9`} placeholder={view === 'cheques' ? 'Search cheque number, payee or file' : 'Search the activity log'} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {view === 'cheques' && (
          <>
            <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Company">
              <option value="">All companies</option>
              {store.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" value={status} onChange={(e) => setStatus(e.target.value as ChequeStatus | '')} aria-label="Status">
              <option value="">Any status</option>
              {(Object.keys(STATUS) as ChequeStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {view === 'cheques' ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm" data-testid="register-table">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 w-28">Status</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2 w-28">Cheque no.</th>
                <th className="px-3 py-2">Payee</th>
                <th className="px-3 py-2 w-32 text-right">Amount</th>
                <th className="px-3 py-2 w-40">Printed</th>
              </tr>
            </thead>
            <tbody>
              {cheques.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-gray-400">
                    Nothing to show.
                  </td>
                </tr>
              )}
              {cheques.slice(0, MAX_ROWS).map((c) => (
                <Fragment key={c.id}>
                  <tr className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setOpenId(openId === c.id ? null : c.id)} data-cheque={c.chequeNumber} data-status={c.status}>
                    <td className="px-3 py-2.5 text-gray-400">{openId === c.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 truncate max-w-48">{nameOf(c)}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-gray-800">{c.chequeNumber || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-800">{c.payee || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-800">{formatMoney(c.amountCents)}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">
                      {stamp(c.printedAt)}
                      {c.printedByName ? ` · ${c.printedByName}` : ''}
                    </td>
                  </tr>
                  {openId === c.id && (
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <td></td>
                      <td colSpan={6} className="px-3 py-4">
                        <Details cheque={c} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {cheques.length > MAX_ROWS && (
            <p className="px-4 py-2 text-xs text-gray-500 border-t">Showing the latest {MAX_ROWS} of {cheques.length}. Narrow the search, or export for the full list.</p>
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm" data-testid="activity-table">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="px-3 py-2 w-40">When</th>
                <th className="px-3 py-2 w-36">Who</th>
                <th className="px-3 py-2 w-48">What</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {activity.slice(0, MAX_ROWS).map((a) => (
                <tr key={a.id} className="border-b border-gray-50 last:border-0" data-action={a.action}>
                  <td className="px-3 py-2 text-xs text-gray-600">{stamp(a.at)}</td>
                  <td className="px-3 py-2 text-gray-800">{a.userName}</td>
                  <td className="px-3 py-2 text-gray-800">{a.action}</td>
                  <td className="px-3 py-2 text-gray-600">{a.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {activity.length > MAX_ROWS && <p className="px-4 py-2 text-xs text-gray-500 border-t">Showing the latest {MAX_ROWS} of {activity.length}. Export for the full log.</p>}
        </div>
      )}
    </div>
  );
}

function Details({ cheque }: { cheque: Cheque }) {
  const { store, user } = useApp();
  const history = store.audit.filter((a) => a.chequeId === cheque.id);
  return (
    <div className="grid grid-cols-2 gap-6 text-sm">
      <div className="space-y-2">
        <p className="text-gray-700">
          Dated {formatDate(cheque.date) || '—'} · {signatureSummary(cheque)}
          {cheque.edited ? ' · details edited by hand' : ''}
        </p>
        {cheque.statusNote && <p className="text-gray-700">Note: {cheque.statusNote}</p>}
        <ul className="space-y-1">
          {cheque.requisitions.map((r) => (
            <li key={r.id} className="flex items-center gap-3 text-xs text-gray-600">
              <span className="truncate">{r.filename}</span>
              <span className="text-gray-400">loaded {stamp(r.importedAt)} by {r.importedByName}</span>
              <button className="text-ncba-teal hover:underline shrink-0" onClick={() => void api.openPdf(r.fileHash)}>
                Open PDF
              </button>
            </li>
          ))}
        </ul>
        {cheque.status === 'printed' && (can(user, 'mark_spoiled') || can(user, 'revert_printed')) && <Corrections cheque={cheque} />}
      </div>
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">History</p>
        <ul className="space-y-1 text-xs text-gray-600">
          {history.length === 0 && <li className="text-gray-400">No entries.</li>}
          {history.map((a) => (
            <li key={a.id}>
              <span className="text-gray-400">{stamp(a.at)}</span> · {a.userName} · <span className="text-gray-800">{a.action}</span>
              {a.details ? ` — ${a.details}` : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Corrections({ cheque }: { cheque: Cheque }) {
  const { user, run } = useApp();
  const [note, setNote] = useState('');
  return (
    <div className="border border-gray-200 bg-white rounded-lg p-3 space-y-2">
      <p className="text-xs text-gray-600">Correct this record (a reason is required):</p>
      <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" onClick={(e) => e.stopPropagation()} />
      <div className="flex gap-2">
        {can(user, 'mark_spoiled') && (
          <Button small variant="danger" onClick={() => run((s, ctx) => markSpoiled(s, ctx, cheque.id, note))}>
            Mark as spoiled
          </Button>
        )}
        {can(user, 'revert_printed') && (
          <Button small onClick={() => run((s, ctx) => revertPrinted(s, ctx, cheque.id, note))}>
            It never printed — put back in queue
          </Button>
        )}
      </div>
    </div>
  );
}
