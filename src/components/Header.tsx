import { Upload, LayoutList, Printer, Settings, LucideIcon } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ActiveTab } from '../types';

const TABS: { id: ActiveTab; label: string; Icon: LucideIcon }[] = [
  { id: 'upload', label: 'Upload', Icon: Upload },
  { id: 'batches', label: 'Batches', Icon: LayoutList },
  { id: 'print', label: 'Print Queue', Icon: Printer },
  { id: 'setup', label: 'Companies', Icon: Settings },
];

export function Header() {
  const { state, dispatch } = useApp();

  const readyCount = state.printQueue.length;

  return (
    <header className="bg-ncba-dark text-white shadow-md">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-white/20 flex items-center justify-center font-bold text-sm">
              NCP
            </div>
            <span className="font-semibold text-lg tracking-tight">NCBA Cheque Printer</span>
          </div>

          <nav className="flex gap-1">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => dispatch({ type: 'SET_TAB', tab: id })}
                className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  state.activeTab === id
                    ? 'bg-white/20 border-b-2 border-white'
                    : 'hover:bg-white/10 border-b-2 border-transparent'
                }`}
              >
                <Icon size={16} />
                {label}
                {id === 'print' && readyCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-amber-400 text-ncba-dark text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {readyCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
