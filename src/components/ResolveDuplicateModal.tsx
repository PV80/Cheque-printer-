import { useState } from 'react';
import { Layers, Trash2 } from 'lucide-react';
import { formatMoney } from '../core/amount';
import { formatDate } from '../core/dates';
import { isSigned, normalisePayee } from '../core/issues';
import { cancelCheque, combineCheques } from '../core/store';
import type { Cheque } from '../core/types';
import { api } from '../platform/api';
import { useApp } from '../state/AppContext';
import { Badge, Button, Modal, Notice } from './ui';

interface Props {
  cheque: Cheque;
  other: Cheque;
  onClose: () => void;
}

function Side({ label, cheque }: { label: string; cheque: Cheque }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500">{label}</span>
        <Badge tone={isSigned(cheque) ? 'green' : 'amber'}>{isSigned(cheque) ? 'Signed' : 'Not signed'}</Badge>
      </div>
      <p className="font-medium text-gray-800">{cheque.payee || 'no payee'}</p>
      <p className="font-mono text-gray-800">KES {formatMoney(cheque.amountCents)}</p>
      <p className="text-xs text-gray-500 mt-1">Dated {formatDate(cheque.date) || '—'}</p>
      <ul className="mt-2 space-y-1">
        {cheque.requisitions.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-xs text-gray-600">
            <span className="truncate">{r.filename}</span>
            <button className="text-ncba-teal hover:underline shrink-0" onClick={() => void api.openPdf(r.fileHash)}>
              Open
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResolveDuplicateModal({ cheque, other, onClose }: Props) {
  const { run } = useApp();
  const [first, second] = cheque.createdAt <= other.createdAt ? [cheque, other] : [other, cheque];
  const samePayee = !!normalisePayee(first.payee) && normalisePayee(first.payee) === normalisePayee(second.payee);
  const total = first.amountCents + second.amountCents;
  // Identical payee, amount and date usually means one requisition saved twice.
  const lookIdentical = samePayee && first.amountCents === second.amountCents && first.date === second.date;
  const [separate, setSeparate] = useState(false);

  const combine = () => run((s, ctx) => combineCheques(s, ctx, first.id, second.id)) && onClose();
  const keep = (winner: Cheque, loser: Cheque) =>
    run((s, ctx) => cancelCheque(s, ctx, loser.id, `Replaced by ${winner.requisitions[0]?.filename ?? 'another requisition'}`)) && onClose();

  return (
    <Modal title={`Two requisitions use cheque ${cheque.chequeNumber}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-4 mb-5">
        <Side label="LOADED FIRST" cheque={first} />
        <Side label="LOADED SECOND" cheque={second} />
      </div>

      <div className="space-y-3">
        <div className="border border-gray-200 rounded-lg p-4">
          <p className="font-medium text-gray-800 text-sm">Both are paid by this one cheque</p>
          {samePayee ? (
            <>
              <p className="text-sm text-gray-600 mt-1">
                One cheque to <strong>{first.payee}</strong> for {formatMoney(first.amountCents)} + {formatMoney(second.amountCents)} ={' '}
                <strong className="font-mono">KES {formatMoney(total)}</strong>.
              </p>
              {lookIdentical && (
                <div className="mt-3 space-y-2">
                  <Notice tone="red">
                    These two have the same payee, amount and date. If they are the same requisition saved twice, combining
                    would pay it twice — keep one instead.
                  </Notice>
                  <label className="flex items-center gap-2 text-sm text-gray-800">
                    <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} data-testid="confirm-separate" />
                    They are two separate payments that happen to match.
                  </label>
                </div>
              )}
              <Button variant="primary" className="mt-3" onClick={combine} disabled={lookIdentical && !separate} data-testid="combine">
                <Layers size={14} /> Combine into one cheque for {formatMoney(total)}
              </Button>
            </>
          ) : (
            <Notice tone="amber">The payees are different, so they cannot share one cheque. Keep one of them.</Notice>
          )}
        </div>

        <div className="border border-gray-200 rounded-lg p-4">
          <p className="font-medium text-gray-800 text-sm">One replaces the other (a corrected requisition)</p>
          <p className="text-sm text-gray-600 mt-1">The one you do not keep is discarded and noted in the register.</p>
          <div className="flex gap-3 mt-3">
            <Button onClick={() => keep(second, first)} data-testid="keep-second">
              <Trash2 size={14} /> Keep the second, discard the first
            </Button>
            <Button onClick={() => keep(first, second)} data-testid="keep-first">
              <Trash2 size={14} /> Keep the first, discard the second
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
