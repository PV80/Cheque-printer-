import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { ChequeData, CompanyProfile, ActiveTab, BatchGroup } from '../types';
import { loadCompanies, saveCompanies, matchCompany } from '../lib/storage';

interface AppState {
  cheques: ChequeData[];
  companies: CompanyProfile[];
  activeTab: ActiveTab;
  selectedChequeId: string | null;
  printQueue: string[];
}

type Action =
  | { type: 'ADD_CHEQUE'; cheque: ChequeData }
  | { type: 'UPDATE_CHEQUE'; cheque: ChequeData }
  | { type: 'REMOVE_CHEQUE'; id: string }
  | { type: 'SET_COMPANIES'; companies: CompanyProfile[] }
  | { type: 'UPSERT_COMPANY'; company: CompanyProfile }
  | { type: 'SET_TAB'; tab: ActiveTab }
  | { type: 'SELECT_CHEQUE'; id: string | null }
  | { type: 'TOGGLE_PRINT_QUEUE'; id: string }
  | { type: 'SET_PRINT_QUEUE'; ids: string[] }
  | { type: 'MARK_PRINTED'; ids: string[] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'ADD_CHEQUE': {
      const companies = state.companies;
      const match = matchCompany(action.cheque.companyRaw, companies);
      const cheque = match
        ? { ...action.cheque, companyId: match.id }
        : action.cheque;
      return { ...state, cheques: [...state.cheques, cheque] };
    }
    case 'UPDATE_CHEQUE':
      return {
        ...state,
        cheques: state.cheques.map((c) =>
          c.id === action.cheque.id ? action.cheque : c
        ),
      };
    case 'REMOVE_CHEQUE':
      return {
        ...state,
        cheques: state.cheques.filter((c) => c.id !== action.id),
        printQueue: state.printQueue.filter((id) => id !== action.id),
      };
    case 'SET_COMPANIES':
      return { ...state, companies: action.companies };
    case 'UPSERT_COMPANY': {
      const exists = state.companies.find((c) => c.id === action.company.id);
      const companies = exists
        ? state.companies.map((c) =>
            c.id === action.company.id ? action.company : c
          )
        : [...state.companies, action.company];
      saveCompanies(companies);
      // Re-match all cheques
      const cheques = state.cheques.map((ch) => {
        const m = matchCompany(ch.companyRaw, companies);
        return m ? { ...ch, companyId: m.id } : ch;
      });
      return { ...state, companies, cheques };
    }
    case 'SET_TAB':
      return { ...state, activeTab: action.tab };
    case 'SELECT_CHEQUE':
      return { ...state, selectedChequeId: action.id };
    case 'TOGGLE_PRINT_QUEUE': {
      const inQueue = state.printQueue.includes(action.id);
      return {
        ...state,
        printQueue: inQueue
          ? state.printQueue.filter((id) => id !== action.id)
          : [...state.printQueue, action.id],
      };
    }
    case 'SET_PRINT_QUEUE':
      return { ...state, printQueue: action.ids };
    case 'MARK_PRINTED':
      return {
        ...state,
        cheques: state.cheques.map((c) =>
          action.ids.includes(c.id) ? { ...c, status: 'printed' } : c
        ),
        printQueue: state.printQueue.filter((id) => !action.ids.includes(id)),
      };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  getBatches: () => BatchGroup[];
  getCompanyForCheque: (cheque: ChequeData) => CompanyProfile | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    cheques: [],
    companies: loadCompanies(),
    activeTab: 'upload',
    selectedChequeId: null,
    printQueue: [],
  });

  useEffect(() => {
    saveCompanies(state.companies);
  }, [state.companies]);

  function getBatches(): BatchGroup[] {
    const groups = new Map<string, BatchGroup>();

    // Group by companyId (or companyRaw for unmatched)
    for (const cheque of state.cheques) {
      const key = cheque.companyId || `unmatched:${cheque.companyRaw}`;
      if (!groups.has(key)) {
        const company = cheque.companyId
          ? state.companies.find((c) => c.id === cheque.companyId)
          : null;
        groups.set(key, {
          companyId: cheque.companyId,
          companyName: company?.name || cheque.companyRaw,
          cheques: [],
        });
      }
      groups.get(key)!.cheques.push(cheque);
    }

    // Sort cheques within each group by cheque number
    for (const group of groups.values()) {
      group.cheques.sort((a, b) => {
        const na = parseInt(a.chequeNumber) || 0;
        const nb = parseInt(b.chequeNumber) || 0;
        return na - nb;
      });
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.companyName.localeCompare(b.companyName)
    );
  }

  function getCompanyForCheque(cheque: ChequeData): CompanyProfile | null {
    if (!cheque.companyId) return null;
    return state.companies.find((c) => c.id === cheque.companyId) || null;
  }

  return (
    <AppContext.Provider value={{ state, dispatch, getBatches, getCompanyForCheque }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
