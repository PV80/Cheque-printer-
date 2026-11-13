// A payroll PDF: many salary slips in one file, one cheque for each.
//
// Each slip opens with a page titled "Salary Slip - NAME - Month Year" and runs
// to the page before the next such title. Unlike a requisition, a slip carries
// no cheque number and no cheque date: whoever loads the payroll supplies those.

import { formatMoney, parseAmountToCents } from './amount';
import { chequeNumbers, parseRequisition } from './parser';
import type { DocumentType, PageRange } from './types';

export interface PayrollSlip {
  /** The pages of the PDF this slip covers. */
  pages: PageRange;
  companyRaw: string;
  payee: string;
  /** The pay period as the title gives it, e.g. "October 2026". */
  period: string;
  /** Net pay; 0 when the slip shows nothing to pay. */
  amountCents: number;
  /** Only when the slip itself names one, which is unusual. */
  chequeNumber: string;
  /** Doubts a person must clear before this can print. */
  reviewNotes: string[];
}

const flat = (line: string) => line.replace(/\s+/g, ' ').trim();
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

const TITLE = /^(?:salary\s+slip|pay\s*slip)\s*[-–—:]\s*(.+?)\s*[-–—]\s*([a-z]{3,9}\.?\s+\d{4})$/i;
const NET = /^net\s+(?:salary|pay)\b\s*:?\s*(.+)$/i;
const TO_PAY = /^to\s+pay\s+on\b.*?\bof\s+(.+?)\s*:\s*(.+)$/i;

/**
 * pages = the lines of each page, as produced by buildLines(). Returns one
 * entry per salary slip, in the order they appear; empty if this is not a payroll.
 */
export function parsePayroll(pages: string[][]): PayrollSlip[] {
  const starts: { page: number; payee: string; period: string }[] = [];
  pages.forEach((lines, index) => {
    for (const line of lines) {
      const title = flat(line).match(TITLE);
      if (title) {
        starts.push({ page: index + 1, payee: flat(title[1]), period: flat(title[2]) });
        break;
      }
    }
  });

  return starts.map((start, k) => {
    const to = k + 1 < starts.length ? starts[k + 1].page - 1 : pages.length;
    const raw = pages.slice(start.page - 1, to).flat();
    const lines = raw.map(flat).filter(Boolean);
    const reviewNotes: string[] = [];

    // The net pay is stated twice: in the table, and in the sentence saying whom to pay.
    let net: number | null = null;
    for (const line of lines) {
      const hit = line.match(NET);
      if (hit) net = parseAmountToCents(hit[1]);
    }
    const toPay = lines.map((line) => line.match(TO_PAY)).find((hit) => hit !== null);
    const toPayCents = toPay ? parseAmountToCents(toPay[2]) : null;

    if (toPay && nameKey(toPay[1]) !== nameKey(start.payee)) {
      reviewNotes.push(`The slip is titled for ${start.payee} but says to pay ${flat(toPay[1])}.`);
    }
    if (net !== null && toPayCents !== null && net !== toPayCents) {
      reviewNotes.push(`The net salary (${formatMoney(net)}) and the amount to pay (${formatMoney(toPayCents)}) differ.`);
    }

    const numbers = chequeNumbers(raw);
    if (numbers.length > 1) reviewNotes.push(`The slip mentions more than one cheque number (${numbers.join(', ')}).`);

    return {
      pages: { from: start.page, to },
      companyRaw: flat(pages[start.page - 1].find((line) => flat(line) !== '') ?? ''),
      payee: start.payee,
      period: start.period,
      amountCents: net ?? toPayCents ?? 0,
      chequeNumber: numbers.length === 1 ? numbers[0] : '',
      reviewNotes,
    };
  });
}

/** Which kind of form a PDF is, for choosing its signature boxes. */
export function formTypeOf(pages: string[][]): DocumentType {
  return parsePayroll(pages).length > 0 ? 'salary_slip' : parseRequisition(pages).documentType;
}

/** The cheque number `steps` leaves after `first`, keeping its leading zeros. '' if `first` is not a number. */
export function chequeNumberAfter(first: string, steps: number): string {
  if (!/^\d{1,12}$/.test(first)) return '';
  const next = String(Number(first) + steps);
  return next.length > 12 ? '' : next.padStart(first.length, '0');
}
