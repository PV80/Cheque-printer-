// The print queue: ready cheques grouped by company, lowest cheque number first,
// plus what the person loading the printer needs to know.

import { normaliseChequeNumber } from './issues';
import type { Cheque, CompanyProfile, Store } from './types';

function numeric(chequeNumber: string): number {
  const n = normaliseChequeNumber(chequeNumber);
  return n ? Number(n) : 0;
}

/** Ascending by number; text order breaks ties so the result is stable. */
export function compareChequeNumbers(a: string, b: string): number {
  return numeric(a) - numeric(b) || a.localeCompare(b);
}

export interface NumberRange {
  from: string;
  to: string;
  count: number;
}

const MAX_GAP_DETAIL = 1000;

/**
 * Leaves that sit between the queued numbers but are not being printed and
 * have not been used before. They must come out of the stack.
 */
export function findMissingNumbers(queued: string[], alreadyUsed: Set<string>): NumberRange[] {
  const sorted = [...queued].sort(compareChequeNumbers);
  const ranges: NumberRange[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const low = numeric(sorted[i - 1]);
    const high = numeric(sorted[i]);
    if (high - low < 2) continue;

    const width = sorted[i - 1].length;
    const pad = (n: number) => String(n).padStart(width, '0');

    if (high - low > MAX_GAP_DETAIL) {
      ranges.push({ from: pad(low + 1), to: pad(high - 1), count: high - low - 1 });
      continue;
    }

    let start = -1;
    for (let n = low + 1; n <= high; n++) {
      const free = n < high && !alreadyUsed.has(String(n));
      if (free && start === -1) start = n;
      if (!free && start !== -1) {
        ranges.push({ from: pad(start), to: pad(n - 1), count: n - start });
        start = -1;
      }
    }
  }
  return ranges;
}

export interface QueueGroup {
  company: CompanyProfile;
  cheques: Cheque[]; // ascending cheque number
  missing: NumberRange[];
  lastPrinted: string | null; // highest number already used for this company
}

/** Cheque numbers (without leading zeros) this company has already printed or spoiled. */
export function usedChequeNumbers(store: Store, companyId: string): Set<string> {
  return new Set(
    store.cheques
      .filter((c) => c.companyId === companyId && (c.status === 'printed' || c.status === 'spoiled'))
      .map((c) => normaliseChequeNumber(c.chequeNumber))
  );
}

/** The number after the highest one this company has in the register ('' if it has none yet). */
export function nextChequeNumber(store: Store, companyId: string): string {
  let highest = '';
  for (const c of store.cheques) {
    if (c.companyId !== companyId || c.status === 'cancelled' || !/^\d{1,12}$/.test(c.chequeNumber)) continue;
    if (highest === '' || Number(c.chequeNumber) > Number(highest)) highest = c.chequeNumber;
  }
  if (highest === '') return '';
  const next = String(Number(highest) + 1);
  return next.length > 12 ? '' : next.padStart(highest.length, '0');
}

/** `isReady` says whether a pending cheque has cleared every check. */
export function buildQueue(store: Store, isReady: (cheque: Cheque) => boolean): QueueGroup[] {
  const groups: QueueGroup[] = [];

  for (const company of store.companies) {
    const mine = store.cheques.filter((c) => c.companyId === company.id);
    const cheques = mine
      .filter((c) => c.status === 'pending' && isReady(c))
      .sort((a, b) => compareChequeNumbers(a.chequeNumber, b.chequeNumber));
    if (cheques.length === 0) continue;

    const used = mine.filter((c) => c.status === 'printed' || c.status === 'spoiled');
    const lastPrinted = used.length
      ? used.map((c) => c.chequeNumber).sort(compareChequeNumbers)[used.length - 1]
      : null;

    groups.push({
      company,
      cheques,
      missing: findMissingNumbers(cheques.map((c) => c.chequeNumber), usedChequeNumbers(store, company.id)),
      lastPrinted,
    });
  }

  return groups.sort((a, b) => a.company.name.localeCompare(b.company.name));
}
