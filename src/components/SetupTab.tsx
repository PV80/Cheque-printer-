import { useState } from 'react';
import { Building2, Database, Users, type LucideIcon } from 'lucide-react';
import { can, type Permission } from '../core/auth';
import { useApp } from '../state/AppContext';
import { CompaniesPanel } from './CompaniesPanel';
import { DataPanel } from './DataPanel';
import { UsersPanel } from './UsersPanel';

type Section = 'companies' | 'users' | 'data';

const SECTIONS: { id: Section; label: string; Icon: LucideIcon; needs: Permission }[] = [
  { id: 'companies', label: 'Companies', Icon: Building2, needs: 'manage_companies' },
  { id: 'users', label: 'People', Icon: Users, needs: 'manage_users' },
  { id: 'data', label: 'Data and backup', Icon: Database, needs: 'manage_data' },
];

export function SetupTab() {
  const { user } = useApp();
  const allowed = SECTIONS.filter((s) => can(user, s.needs));
  const [section, setSection] = useState<Section>(allowed[0]?.id ?? 'companies');

  if (allowed.length === 0) {
    return <p className="max-w-xl mx-auto py-16 px-4 text-center text-gray-500">Setup is for administrators.</p>;
  }

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 flex gap-6">
      <nav className="w-44 shrink-0 space-y-1" aria-label="Setup sections">
        {allowed.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            data-section={id}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
              section === id ? 'bg-ncba-dark text-white' : 'text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0">
        {section === 'companies' && <CompaniesPanel />}
        {section === 'users' && <UsersPanel />}
        {section === 'data' && <DataPanel />}
      </div>
    </div>
  );
}
