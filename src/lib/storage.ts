import { CompanyProfile, ChequeTemplate } from '../types';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'ncba_cheque_companies';

// Positions measured from actual NCBA Kenya cheque photos.
// "Kenya Shillings" and "Pay" and "Ksh" are pre-printed on the physical cheque.
// We only print the variable text AFTER those pre-printed labels.
export const DEFAULT_TEMPLATE: ChequeTemplate = {
  chequeWidth: 215,
  chequeHeight: 85,
  pageTopOffset: 0,
  fields: {
    date: {
      // After the pre-printed "Date" label, top-right of cheque
      x: 148,
      y: 12,
      width: 62,
      fontSize: 11,
      fontFamily: 'Arial',
      fontWeight: 'normal',
      align: 'left',
    },
    payee: {
      // After the pre-printed "Pay" label
      x: 22,
      y: 34,
      width: 128,
      fontSize: 11,
      fontFamily: 'Arial',
      fontWeight: 'normal',
      align: 'left',
    },
    amountFigures: {
      // After the pre-printed "Ksh" label on the right side of the Pay line
      x: 159,
      y: 34,
      width: 52,
      fontSize: 11,
      fontFamily: 'Arial',
      fontWeight: 'bold',
      align: 'left',
    },
    amountWords: {
      // After the pre-printed "Kenya Shillings" label, wraps to second line
      x: 44,
      y: 46,
      width: 163,
      height: 18,
      fontSize: 11,
      fontFamily: 'Arial',
      fontWeight: 'normal',
      align: 'left',
      wrap: true,
    },
  },
};

export function loadCompanies(): CompanyProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CompanyProfile[];
    // Migrate older profiles that lack printerType / offsets
    return parsed.map((c) => ({
      ...c,
      printerType: c.printerType ?? ('laser' as const),
      printerOffsetX: c.printerOffsetX ?? 0,
      printerOffsetY: c.printerOffsetY ?? 0,
    }));
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
    printerType: 'laser',
    printerOffsetX: 0,
    printerOffsetY: 0,
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
