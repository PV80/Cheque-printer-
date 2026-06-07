import { useState } from 'react';
import { X } from 'lucide-react';
import { ChequeData } from '../types';
import { useApp } from '../context/AppContext';
import { createCompany } from '../lib/storage';

interface Props {
  cheque: ChequeData;
  onClose: () => void;
}

export function AssignCompanyModal({ cheque, onClose }: Props) {
  const { state, dispatch } = useApp();
  const [mode, setMode] = useState<'pick' | 'new'>('pick');
  const [newName, setNewName] = useState(cheque.companyRaw);

  function assignExisting(companyId: string) {
    const company = state.companies.find((c) => c.id === companyId)!;
    const updated: ChequeData = { ...cheque, companyId };
    dispatch({ type: 'UPDATE_CHEQUE', cheque: updated });
    // Also add this raw name as an alias
    dispatch({
      type: 'UPSERT_COMPANY',
      company: {
        ...company,
        aliases: [...new Set([...company.aliases, cheque.companyRaw])],
      },
    });
    onClose();
  }

  function createNew() {
    const company = createCompany(newName.trim(), [cheque.companyRaw]);
    dispatch({ type: 'UPSERT_COMPANY', company });
    const updated: ChequeData = { ...cheque, companyId: company.id };
    dispatch({ type: 'UPDATE_CHEQUE', cheque: updated });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-800">Assign Company</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-gray-600 mb-4">
            PDF shows: <span className="font-medium text-gray-800">"{cheque.companyRaw}"</span>
          </p>

          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setMode('pick')}
              className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                mode === 'pick'
                  ? 'bg-ncba-teal text-white border-ncba-teal'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Use existing company
            </button>
            <button
              onClick={() => setMode('new')}
              className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
                mode === 'new'
                  ? 'bg-ncba-teal text-white border-ncba-teal'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Create new company
            </button>
          </div>

          {mode === 'pick' && (
            <div className="space-y-2">
              {state.companies.length === 0 ? (
                <p className="text-sm text-gray-400 italic text-center py-4">
                  No companies set up yet — create one.
                </p>
              ) : (
                state.companies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => assignExisting(c.id)}
                    className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-ncba-teal hover:bg-ncba-light transition-colors"
                  >
                    <span className="font-medium text-gray-800">{c.name}</span>
                    {c.bankAccount && (
                      <span className="text-xs text-gray-500 ml-2">A/C {c.bankAccount}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          {mode === 'new' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Company name (as you want it displayed)
                </label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ncba-teal"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <p className="text-xs text-gray-500">
                A default NCBA cheque template will be created. Calibrate field positions in the Companies tab.
              </p>
              <button
                onClick={createNew}
                disabled={!newName.trim()}
                className="w-full py-2 bg-ncba-teal text-white rounded-lg text-sm hover:bg-ncba-dark disabled:opacity-50 transition-colors"
              >
                Create Company &amp; Assign
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
