import { useState } from 'react';
import { FileText, Save } from 'lucide-react';
import { amountToWords, formatFigures, formatMoney, parseAmountToCents } from '../core/amount';
import { formatDate, parseDate } from '../core/dates';
import { editCheque } from '../core/store';
import type { Cheque } from '../core/types';
import { api } from '../platform/api';
import { useApp } from '../state/AppContext';
import { Button, Field, Modal, Notice } from './ui';

interface Props {
  cheque: Cheque;
  onClose: () => void;
}

export function EditChequeModal({ cheque, onClose }: Props) {
  const { run, issuesOf } = useApp();
  const [chequeNumber, setChequeNumber] = useState(cheque.chequeNumber);
  const [date, setDate] = useState(formatDate(cheque.date) || cheque.requisitions[0]?.dateRaw || '');
  const [payee, setPayee] = useState(cheque.payee);
  const [amount, setAmount] = useState(cheque.amountCents > 0 ? formatMoney(cheque.amountCents) : '');
  const [error, setError] = useState('');

  const cents = parseAmountToCents(amount);
  const iso = parseDate(date);
  const mismatch = issuesOf(cheque).find((i) => i.kind === 'amount_mismatch');
  const doubts = cheque.amountConfirmed ? [] : cheque.requisitions.flatMap((r) => r.reviewNotes ?? []);

  function save() {
    if (!payee.trim()) return setError('Enter the payee.');
    if (!iso) return setError('Enter the date as DD/MM/YYYY.');
    if (cents === null || cents <= 0) return setError('Enter the amount, e.g. 15,000 or 15,000.50.');
    if (!/^\d{1,12}$/.test(chequeNumber.trim())) return setError('The cheque number must be digits only.');
    const ok = run((s, ctx) => editCheque(s, ctx, cheque.id, { payee, date: iso, amountCents: cents, chequeNumber }));
    if (ok) onClose();
  }

  return (
    <Modal
      title="Check and correct cheque details"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} data-testid="save-edit">
            <Save size={14} /> Save — these details are correct
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {mismatch && <Notice tone="amber">{mismatch.message} Enter the amount that should be paid.</Notice>}
        {doubts.map((note) => (
          <Notice key={note} tone="amber">
            {note}
          </Notice>
        ))}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cheque number" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} inputMode="numeric" />
          <Field label="Date (DD/MM/YYYY)" value={date} onChange={(e) => setDate(e.target.value)} placeholder="05/06/2026" />
        </div>
        <Field label="Payee" value={payee} onChange={(e) => setPayee(e.target.value)} />
        <Field label="Amount (KES)" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="15,000.00" inputMode="decimal" />

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
          <p className="text-xs text-gray-500 mb-1">Will be printed as</p>
          {cents !== null && cents > 0 ? (
            <>
              <p className="font-mono font-semibold text-gray-800">{formatFigures(cents)}</p>
              <p className="text-gray-800">{amountToWords(cents)}</p>
            </>
          ) : (
            <p className="text-gray-400">Enter an amount</p>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">What the requisition says</p>
          <ul className="space-y-2">
            {cheque.requisitions.map((r) => (
              <li key={r.id} className="border border-gray-200 rounded-lg p-3 text-xs text-gray-700">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="flex items-center gap-1.5 font-medium truncate">
                    <FileText size={13} className="text-gray-400 shrink-0" /> {r.filename}
                  </span>
                  <Button small onClick={() => void api.openPdf(r.fileHash)}>
                    Open PDF
                  </Button>
                </div>
                <p>Payee: {r.payee || '—'}</p>
                <p>Date: {r.dateRaw || '—'} · Cheque: {r.chequeNumber || '—'}</p>
                <p>
                  Figures: {r.amountCents > 0 ? formatMoney(r.amountCents) : '—'} · Words: {r.amountWordsRaw || '—'}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {error && <Notice tone="red">{error}</Notice>}
      </div>
    </Modal>
  );
}
