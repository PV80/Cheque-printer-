import { CompanyProfile, ChequeTemplate } from '../types';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'ncba_cheque_companies';

export const DEFAULT_TEMPLATE: ChequeTemplate = {
  chequeWidth: 215,
  chequeHeight: 85,
  pageTopOffset: 0,
  fields: {
    date: {
      x: 148,
      y: 14,
      width: 60,
      fontSize: 11,
      fontFamily: 'Arial',
      fontWeight: 'normal',
      align: 'left',
    },
    payee: {
      x: 30,
      y: 29,
      width: 160,
      fontSize: 11,
      fontFamily: 'Arial',
      fontWeight: 'normal',
      align: 'left',
    },
    amountWords: {
      x: 18,
      y: 43,
      width: 145,
      fontSize: 10,
      fontFamily: 'Arial',
      fontWeight: 'normal',
      align: 'left',
    },
    amountFigures: {
      x: 168,
      y: 43,
      width: 42,
      fontSize: 11,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      align: 'right',
    },
  },
};

export function loadCompanies(): CompanyProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CompanyProfile[]) : [];
  } catch {
    return [];
  }
}

export function saveCompanies(companies: CompanyProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(companies));
}

export function createCompany(name: string, aliases: string[] = []): CompanyProfile {
  return {
    id: uuidv4(),
    name,
    aliases: [name, ...aliases],
    template: structuredClone(DEFAULT_TEMPLATE),
  };
}

export function matchCompany(
  rawName: string,
  companies: CompanyProfile[]
): CompanyProfile | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normRaw = norm(rawName);
  return (
    companies.find((c) =>
      c.aliases.some(
        (alias) =>
          norm(alias).includes(normRaw) ||
          normRaw.includes(norm(alias))
      )
    ) || null
  );
}
