import { useState } from 'react';
import { AlertTriangle, CheckCircle, FileText, Loader, Lock, Trash2 } from 'lucide-react';
import { can } from '../core/auth';
import type { Issue } from '../core/issues';
import { compareChequeNumbers } from '../core/queue';
import { cancelCheque } from '../core/store';
import type { Cheque, CompanyProfile, OverrideKind } from '../core/types';
import { api } from '../platform/api';
import { useApp } from '../state/AppContext';
import { AssignCompanyModal } from './AssignCompanyModal';
import { EditChequeModal } from './EditChequeModal';
import { OverrideModal } from './OverrideModal';
import { PrintResultsModal } from './PrintRunModal';
import { ResolveDuplicateModal } from './ResolveDuplicateModal';
import { SignatureZoneModal } from './SignatureZoneModal';
import { Button, ChequeFacts, EmptyState } from './ui';

type Dialog =
  | { type: 'edit'; cheque: Cheque }
  | { type: 'assign'; cheque: Cheque }
  | { type: 'override'; cheque: Cheque; kind: OverrideKind; message: string }
  | { type: 'resolve'; cheque: Cheque; other: Cheque }
  | { type: 'zone'; company: CompanyProfile; fileHash: string }
  | { type: 'results'; company: CompanyProfile; cheques: Cheque[] };

export function HeldTab() {
  const { held, issuesOf, store, user, run, notify } = useApp();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  if (held.length === 0) {
    return (
      <EmptyState icon={<CheckCircle size={48} />} title="Nothing is held.">
        Requisitions that are unsigned, incomplete or look like duplicates wait here.
      </EmptyState>
    );
  }

  function discard(cheque: Cheque) {
    if (!window.confirm(`Discard this requisition (cheque ${cheque.chequeNumber || 'no number'}, ${cheque.payee || 'no payee'})? It will not be printed.`)) return;
    if (run((s, ctx) => cancelCheque(s, ctx, cheque.id, 'Discarded from the held list'))) notify('info', 'Requisition discarded.');
  }

  /** The fix offered for an issue, depending on who is signed in. */
  function fixFor(cheque: Cheque, issue: Issue): JSX.Element | null {
    const needs = (who: string) => (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
        <Lock size={12} /> Needs {who}
      </span>
    );
    const company = store.companies.find((c) => c.id === cheque.companyId);

    switch (issue.kind) {
      case 'print_unconfirmed': {
        if (!company) return null;
        // Everything from the same interrupted run is recorded together.
        const sameRun = store.cheques
          .filter((c) => c.status === 'pending' && c.companyId === company.id && c.printSentAt)
          .sort((a, b) => compareChequeNumbers(a.chequeNumber, b.chequeNumber));
        return (
          <Button small variant="primary" onClick={() => setDialog({ type: 'results', company, cheques: sameRun })} data-testid="record-result">
            Record result…
          </Button>
        );
      }
      case 'unsigned':
      case 'duplicate_payment': {
        const unsigned = cheque.requisitions.find((r) => r.signature.status === 'not_signed');
        return (
          <span className="inline-flex items-center gap-2">
            {/* If it is signed but was not seen, the box is in the wrong place: fix that first. */}
            {issue.kind === 'unsigned' && company && unsigned && can(user, 'manage_companies') && (
              <Button small onClick={() => setDialog({ type: 'zone', company, fileHash: unsigned.fileHash })} data-testid="zone-fix">
                Signature box…
              </Button>
            )}
            <Button small onClick={() => setDialog({ type: 'override', cheque, kind: issue.kind as OverrideKind, message: issue.message })} data-testid="override-open">
              {can(user, 'override') ? 'Override…' : 'Supervisor override…'}
            </Button>
          </span>
        );
      }
      case 'no_company':
        return can(user, 'assign_company') ? (
          <Button small onClick={() => setDialog({ type: 'assign', cheque })}>Choose company…</Button>
        ) : (
          needs('a supervisor')
        );
      case 'missing_fields':
      case 'needs_review':
      case 'amount_mismatch':
      case 'text_too_long':
        return can(user, 'edit_cheque') ? (
          <Button small onClick={() => setDialog({ type: 'edit', cheque })} data-testid="edit-open">Check details…</Button>
        ) : (
          needs('a supervisor')
        );
      case 'signature_zone_missing':
        return company && can(user, 'manage_companies') ? (
          <Button small onClick={() => setDialog({ type: 'zone', company, fileHash: cheque.requisitions[0]?.fileHash ?? '' })} data-testid="zone-open">
            Set signature box…
          </Button>
        ) : (
          needs('an administrator')
        );
      case 'signature_unchecked':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Loader size={12} className="animate-spin" /> Checking
          </span>
        );
      case 'duplicate_number': {
        const other = store.cheques.find((c) => c.id === issue.relatedChequeId);
        if (issue.hard || !other) return null;
        return (
          <Button small onClick={() => setDialog({ type: 'resolve', cheque, other })} data-testid="resolve-open">
            Sort out…
          </Button>
        );
      }
      default:
        return null;
    }
  }

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <h1 className="text-xl font-bold text-gray-800 mb-1">
        Held <span className="ml-1 text-base font-normal text-gray-500">{held.length}</span>
      </h1>
      <p className="text-sm text-gray-500 mb-5">
        These will not print until every point below is cleared. To replace an unsigned requisition, just drop the signed copy.
      </p>

      <ul className="space-y-3" data-testid="held-list">
        {held.map((cheque) => {
          const company = store.companies.find((c) => c.id === cheque.companyId);
          return (
            <li key={cheque.id} className="bg-white rounded-xl border border-amber-200 shadow-sm p-4" data-cheque={cheque.chequeNumber}>
              <div className="flex items-start justify-between gap-4">
                <ChequeFacts cheque={cheque} companyName={company?.name ?? (cheque.companyRaw || 'Unknown company')} />
                <div className="flex items-center gap-2 shrink-0">
                  {cheque.requisitions.map((r) => (
                    <Button key={r.id} small variant="ghost" onClick={() => void api.openPdf(r.fileHash)} title={r.filename}>
                      <FileText size={13} /> Open PDF
                    </Button>
                  ))}
                  <Button small variant="danger" onClick={() => discard(cheque)}>
                    <Trash2 size={13} /> Discard
                  </Button>
                </div>
              </div>

              <ul className="mt-3 space-y-2">
                {issuesOf(cheque).map((issue, i) => (
                  <li key={i} data-issue={issue.kind} className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <span className="flex items-start gap-2 text-sm text-amber-900">
                      <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-500" />
                      {issue.message}
                    </span>
                    <span className="shrink-0">{fixFor(cheque, issue)}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>

      {dialog?.type === 'edit' && <EditChequeModal cheque={dialog.cheque} onClose={close} />}
      {dialog?.type === 'assign' && <AssignCompanyModal cheque={dialog.cheque} onClose={close} />}
      {dialog?.type === 'override' && <OverrideModal cheque={dialog.cheque} kind={dialog.kind} message={dialog.message} onClose={close} />}
      {dialog?.type === 'resolve' && <ResolveDuplicateModal cheque={dialog.cheque} other={dialog.other} onClose={close} />}
      {dialog?.type === 'zone' && <SignatureZoneModal companyId={dialog.company.id} fileHash={dialog.fileHash} onClose={close} />}
      {dialog?.type === 'results' && <PrintResultsModal company={dialog.company} cheques={dialog.cheques} initial="printed" onDone={close} />}
    </div>
  );
}
