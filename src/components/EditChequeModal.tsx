import { useState } from 'react';
import { X, Save } from 'lucide-react';
import { ChequeData } from '../types';
import { useApp } from '../context/AppContext';
import { amountToWords, parseAmountString } from '../lib/amountToWords';

interface Props {
  cheque: ChequeData;
  onClose: () => void;
}

export function EditChequeModal({ cheque, onClose }: Props) {
  const { dispatch } = useApp();
  const [form, setForm] = useState({
    payee: cheque.payee,
    date: cheque.date,
    amountFigures: cheque.amountFigures.toString(),
    amountWords: cheque.amountWords,
    chequeNumber: cheque.chequeNumber,
  });

  function handleAmountChange(val: string) {
    const num = parseAmountString(val);
    setForm((f) => ({
      ...f,
      amountFigures: val,
      amountWords: num > 0 ? amountToWords(num) : f.amountWords,
    }));
  }

  function save() {
    const updated: ChequeData = {
      ...cheque,
      payee: form.payee.trim(),
      date: form.date.trim(),
      amountFigures: parseAmountString(form.amountFigures),
      amountWords: form.amountWords.trim(),
      chequeNumber: form.chequeNumber.trim(),
      status: 'ready',
    };
    dispatch({ type: 'UPDATE_CHEQUE', cheque: updated });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-800">Edit Cheque Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">CHQ #</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ncba-teal"
              value={form.chequeNumber}
              onChange={(e) => setForm((f) => ({ ...f, chequeNumber: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date (DD/MM/YYYY)</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ncba-teal"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              placeholder="05/06/2026"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Payee</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ncba-teal"
              value={form.payee}
              onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Amount (figures) — type number to auto-generate words
            </label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ncba-teal"
              value={form.amountFigures}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="15000"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Amount in words</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ncba-teal resize-none"
              rows={2}
              value={form.amountWords}
              onChange={(e) => setForm((f) => ({ ...f, amountWords: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-ncba-teal text-white rounded-lg hover:bg-ncba-dark transition-colors"
          >
            <Save size={14} />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
