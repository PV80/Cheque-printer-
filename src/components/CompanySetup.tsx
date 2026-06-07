import { useState } from 'react';
import { Plus, Building2, ChevronRight, Trash2, Edit2, X, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { createCompany } from '../lib/storage';
import { CalibrationTool } from './CalibrationTool';
import { CompanyProfile } from '../types';

export function CompanySetup() {
  const { state, dispatch } = useApp();
  const [calibrating, setCalibrating] = useState<CompanyProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAccount, setNewAccount] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  function handleCreate() {
    if (!newName.trim()) return;
    const company = createCompany(newName.trim());
    if (newAccount.trim()) company.bankAccount = newAccount.trim();
    dispatch({ type: 'UPSERT_COMPANY', company });
    setCreating(false);
    setNewName('');
    setNewAccount('');
    setCalibrating(company);
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this company profile? Calibration data will be lost.')) return;
    const updated = state.companies.filter((c) => c.id !== id);
    dispatch({ type: 'SET_COMPANIES', companies: updated });
    if (calibrating?.id === id) setCalibrating(null);
  }

  function startEdit(company: CompanyProfile) {
    setEditingId(company.id);
    setEditName(company.name);
  }

  function saveEdit(company: CompanyProfile) {
    dispatch({
      type: 'UPSERT_COMPANY',
      company: { ...company, name: editName.trim() || company.name },
    });
    setEditingId(null);
  }

  if (calibrating) {
    const latest = state.companies.find((c) => c.id === calibrating.id) || calibrating;
    return (
      <div className="max-w-5xl mx-auto py-4 md:py-6 px-3 md:px-4">
        <div className="md:hidden mb-4 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
          Calibration is best done on a desktop. You can still save settings here.
        </div>
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setCalibrating(null)}
            className="text-sm text-ncba-teal hover:underline"
          >
            ← Companies
          </button>
          <ChevronRight size={14} className="text-gray-400" />
          <span className="text-gray-800 font-semibold">{latest.name} — Calibration</span>
        </div>
        <CalibrationTool company={latest} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-4 md:py-6 px-3 md:px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-800">Company Profiles</h1>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-ncba-teal text-white text-sm rounded-lg hover:bg-ncba-dark transition-colors"
        >
          <Plus size={16} />
          Add company
        </button>
      </div>

      {creating && (
        <div className="mb-4 border border-ncba-teal/30 bg-ncba-light rounded-xl p-5">
          <h3 className="font-semibold text-gray-800 mb-3">New Company</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Company name (as displayed in the app)
              </label>
              <input
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ncba-teal"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Golden Ivy Investments Ltd"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                NCBA account number (optional, for reference)
              </label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ncba-teal"
                value={newAccount}
                onChange={(e) => setNewAccount(e.target.value)}
                placeholder="e.g. 1234567890"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setCreating(false); setNewName(''); setNewAccount(''); }}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="px-4 py-2 text-sm bg-ncba-teal text-white rounded-lg hover:bg-ncba-dark disabled:opacity-50 transition-colors"
              >
                Create &amp; Calibrate
              </button>
            </div>
          </div>
        </div>
      )}

      {state.companies.length === 0 && !creating ? (
        <div className="text-center py-16 text-gray-500">
          <Building2 size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-lg">No companies set up yet.</p>
          <p className="text-sm mt-1">Create a company profile to configure cheque field positions.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {state.companies.map((company) => {
            const chequeCount = state.cheques.filter((c) => c.companyId === company.id).length;
            const isEditing = editingId === company.id;

            return (
              <div
                key={company.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-lg bg-ncba-light flex items-center justify-center">
                  <Building2 size={20} className="text-ncba-teal" />
                </div>

                <div className="flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        className="border border-ncba-teal rounded px-2 py-1 text-sm"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(company);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                      <button onClick={() => saveEdit(company)} className="text-green-600 hover:text-green-700">
                        <Check size={16} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <p className="font-semibold text-gray-800">{company.name}</p>
                  )}
                  <div className="flex items-center gap-3 mt-0.5">
                    {company.bankAccount && (
                      <span className="text-xs text-gray-500">A/C {company.bankAccount}</span>
                    )}
                    <span className="text-xs text-gray-400">
                      {company.aliases.length} PDF name alias{company.aliases.length !== 1 ? 'es' : ''}
                    </span>
                    <span className="text-xs text-gray-400">
                      {chequeCount} cheque{chequeCount !== 1 ? 's' : ''} loaded
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(company)}
                    className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Rename"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={() => setCalibrating(company)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-ncba-teal text-ncba-teal rounded-lg hover:bg-ncba-light transition-colors"
                  >
                    Calibrate fields
                    <ChevronRight size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(company.id)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        <p className="font-semibold mb-1">Calibration tip</p>
        <p className="mb-2">
          Click "Calibrate fields" to position the date, payee, amount and words fields on your NCBA cheque.
          Use "Print test" to print sample data on a blank cheque, measure the offset, and adjust until perfect.
        </p>
        <p className="md:hidden text-amber-700 font-medium">
          Tip: The calibration tool works best on a desktop or laptop where you can drag fields precisely.
        </p>
      </div>
    </div>
  );
}
