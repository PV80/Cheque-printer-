import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { can } from '../core/auth';
import { assignCompany, newCompany, saveCompany } from '../core/store';
import type { Cheque } from '../core/types';
import { useApp } from '../state/AppContext';
import { Button, Field, Modal, Notice } from './ui';

interface Props {
  cheque: Cheque;
  onClose: () => void;
}

export function AssignCompanyModal({ cheque, onClose }: Props) {
  const { store, user, run } = useApp();
  const [newName, setNewName] = useState(cheque.companyRaw);
  const canCreate = can(user, 'manage_companies');

  function assign(companyId: string) {
    if (run((s, ctx) => assignCompany(s, ctx, cheque.id, companyId))) onClose();
  }

  function createAndAssign() {
    const id = crypto.randomUUID();
    const ok = run((s, ctx) => assignCompany(saveCompany(s, ctx, newCompany(id, newName)), ctx, cheque.id, id));
    if (ok) onClose();
  }

  return (
    <Modal title="Which company is this cheque from?" onClose={onClose}>
      <p className="text-sm text-gray-600 mb-4">
        The requisition says: <span className="font-medium text-gray-800">"{cheque.companyRaw || 'nothing readable'}"</span>
      </p>

      {store.companies.length === 0 ? (
        <Notice tone="amber">No companies have been set up yet.</Notice>
      ) : (
        <ul className="space-y-2">
          {store.companies.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => assign(c.id)}
                className="w-full flex items-center gap-3 text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-ncba-teal hover:bg-ncba-light transition-colors"
              >
                <Building2 size={16} className="text-ncba-teal shrink-0" />
                <span className="font-medium text-gray-800">{c.name}</span>
                {c.bankAccount && <span className="text-xs text-gray-500">A/C {c.bankAccount}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-gray-500 mt-3">
        The app will remember this name, so future requisitions from the same company are recognised automatically.
      </p>

      {canCreate && (
        <div className="mt-5 pt-4 border-t space-y-3">
          <Field label="Or add it as a new company" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button variant="primary" disabled={!newName.trim()} onClick={createAndAssign}>
            Create company and assign
          </Button>
          <p className="text-xs text-gray-500">It starts with the standard cheque layout. Check it with a test print in Setup.</p>
        </div>
      )}
    </Modal>
  );
}
