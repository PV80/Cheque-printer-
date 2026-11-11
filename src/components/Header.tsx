import { ClipboardList, Inbox, LogOut, Printer, Settings, Upload, type LucideIcon } from 'lucide-react';
import { can, ROLE_LABELS } from '../core/auth';
import { useApp, type Tab } from '../state/AppContext';

export function Header() {
  const { user, tab, setTab, held, queue, signOut } = useApp();
  if (!user) return null;

  const queued = queue.reduce((n, g) => n + g.cheques.length, 0);
  const showSetup = can(user, 'manage_companies') || can(user, 'manage_users') || can(user, 'manage_data');

  const tabs: { id: Tab; label: string; Icon: LucideIcon; count?: number; tone?: string }[] = [
    { id: 'import', label: 'Load', Icon: Upload },
    { id: 'held', label: 'Held', Icon: Inbox, count: held.length, tone: 'bg-amber-400 text-gray-900' },
    { id: 'queue', label: 'Print queue', Icon: Printer, count: queued, tone: 'bg-white text-ncba-dark' },
    { id: 'register', label: 'Register', Icon: ClipboardList },
    ...(showSetup ? [{ id: 'setup' as Tab, label: 'Setup', Icon: Settings }] : []),
  ];

  return (
    <header className="bg-ncba-dark text-white shadow-md sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14 gap-4">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded bg-white/20 flex items-center justify-center font-bold text-sm">CP</div>
          <span className="font-semibold text-lg tracking-tight whitespace-nowrap">Cheque Printer</span>
        </div>

        <nav className="flex gap-1 h-full" aria-label="Sections">
          {tabs.map(({ id, label, Icon, count, tone }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              data-tab={id}
              aria-current={tab === id ? 'page' : undefined}
              className={`flex items-center gap-2 px-4 text-sm font-medium transition-colors border-b-2 ${
                tab === id ? 'bg-white/20 border-white' : 'hover:bg-white/10 border-transparent'
              }`}
            >
              <Icon size={16} />
              {label}
              {!!count && (
                <span className={`text-xs font-bold rounded-full min-w-5 h-5 px-1.5 flex items-center justify-center ${tone}`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right leading-tight">
            <p className="text-sm font-medium">{user.displayName}</p>
            <p className="text-xs text-white/70">{ROLE_LABELS[user.role]}</p>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-white/40 rounded-lg hover:bg-white/10"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
