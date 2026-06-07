import { Upload, LayoutList, Printer, Settings, LucideIcon } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ActiveTab } from '../types';

const TABS: { id: ActiveTab; label: string; Icon: LucideIcon }[] = [
  { id: 'upload', label: 'Upload', Icon: Upload },
  { id: 'batches', label: 'Batches', Icon: LayoutList },
  { id: 'print', label: 'Print', Icon: Printer },
  { id: 'setup', label: 'Companies', Icon: Settings },
];

export function Header() {
  const { state, dispatch } = useApp();
  const readyCount = state.printQueue.length;

  return (
    <>
      {/* Top bar — always visible */}
      <header className="bg-ncba-dark text-white shadow-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-12 md:h-14">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 md:w-8 md:h-8 rounded bg-white/20 flex items-center justify-center font-bold text-xs md:text-sm shrink-0">
              NCP
            </div>
            <span className="font-semibold text-base md:text-lg tracking-tight whitespace-nowrap">
              NCBA Cheque Printer
            </span>
          </div>

          {/* Desktop nav tabs — hidden on mobile */}
          <nav className="hidden md:flex gap-1">
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
      </header>

      {/* Mobile bottom nav — visible only on mobile */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg">
        <div className="grid grid-cols-4 h-16">
          {TABS.map(({ id, label, Icon }) => {
            const active = state.activeTab === id;
            return (
              <button
                key={id}
                onClick={() => dispatch({ type: 'SET_TAB', tab: id })}
                className={`relative flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-ncba-teal' : 'text-gray-500'
                }`}
              >
                <div className={`p-1.5 rounded-lg transition-colors ${active ? 'bg-ncba-light' : ''}`}>
                  <Icon size={20} />
                </div>
                <span className="text-xs font-medium">{label}</span>
                {id === 'print' && readyCount > 0 && (
                  <span className="absolute top-1.5 right-4 bg-amber-400 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {readyCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
