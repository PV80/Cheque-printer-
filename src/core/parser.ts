// Reads the cheque details out of a requisition's text.
//
// The PDF text arrives as positioned fragments. buildLines() rebuilds the
// visual lines; parseRequisition() then looks for labelled values on the
// first page. Two forms are known: the typed "Cheque Requisition Voucher" and
// the ERP "Payment Receipt". Anything that cannot be read for certain is left
// empty or noted for a person to confirm — it never guesses.

import { parseAmountToCents, wordsToCents } from './amount';
import { findDateInText, readDate } from './dates';
import type { DocumentType } from './types';

export interface TextItem {
  str: string;
  x: number; // left edge
  y: number; // baseline, measured downward from the top of the page
  width: number;
  height: number;
}

const COLUMN_GAP = '   ';
const COLUMN_SPLIT = /\s{3,}/;

/** Groups text fragments into lines, top to bottom. Wide gaps become three spaces. */
export function buildLines(items: TextItem[]): string[] {
  const usable = items.filter((i) => i.str.trim() !== '');
  usable.sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: { y: number; height: number; items: TextItem[] }[] = [];
  for (const item of usable) {
    const row = rows[rows.length - 1];
    const tolerance = Math.max(2, 0.5 * Math.max(item.height, row?.height ?? 0));
    if (row && Math.abs(item.y - row.y) <= tolerance) {
      row.items.push(item);
      row.height = Math.max(row.height, item.height);
    } else {
      rows.push({ y: item.y, height: item.height, items: [item] });
    }
  }

  return rows.map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    let line = '';
    let prev: TextItem | null = null;
    for (const item of row.items) {
      const text = item.str.replace(/\s+/g, ' ');
      if (prev) {
        const gap = item.x - (prev.x + prev.width);
        const h = Math.max(prev.height, item.height) || 10;
        if (gap > 1.6 * h) line = line.trimEnd() + COLUMN_GAP;
        else if (gap > 0.15 * h && !line.endsWith(' ') && !text.startsWith(' ')) line += ' ';
      }
      line += prev && line.endsWith(' ') ? text.trimStart() : text;
      prev = item;
    }
    return line.trim();
  });
}

// ---- Labels -------------------------------------------------------------------

type LabelKey =
  | 'words'
  | 'payee'
  | 'chq'
  | 'paymentAmount'
  | 'amount'
  | 'datePayment'
  | 'dateRequisition'
  | 'date'
  | 'stop';

const SEP = String.raw`\s*[:\-–]?\s*`;
const COLON = String.raw`\s*:\s*`;
const AMOUNT_AHEAD = String.raw`(?=(?:kshs?|kes|shs?)?\.?\s*\d)`;
const DATE_AHEAD = String.raw`(?=\d|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)`;
const IN_BRACKETS = String.raw`\s*(?:\(\s*(?:kshs?|kes)\.?\s*\))?`;

// A label only counts when what follows it has the right shape (digits after
// CHQ, a date after DATE...) or it is clearly set apart. That stops a payee
// called "Date Palm Supplies" or "Bank of Africa" from being cut short.
const LABELS: { key: LabelKey; re: RegExp; needsBoundary?: boolean }[] = [
  { key: 'words', re: new RegExp(String.raw`\bamount\s+in\s+words\b${SEP}`, 'gi'), needsBoundary: true },
  { key: 'words', re: new RegExp(String.raw`\b(?:kenya\s+)?shillings?${COLON}`, 'gi') },
  { key: 'words', re: new RegExp(String.raw`^\s*(?:kenya\s+)?shillings?\b${SEP}`, 'gi') },
  {
    key: 'payee',
    re: new RegExp(
      String.raw`\b(?:payee(?:['’]s)?(?:\s+name)?|pay(?:able)?\s+to|paid\s+to|vendor(?:\s+name)?|supplier(?:\s+name)?)\b${SEP}`,
      'gi'
    ),
    needsBoundary: true,
  },
  // Seen on real vouchers: the label is typed "PAYE:". Only with its colon,
  // because PAYE is also the name of a tax.
  { key: 'payee', re: new RegExp(String.raw`\bpaye${COLON}`, 'gi') },
  {
    key: 'chq',
    re: new RegExp(String.raw`\b(?:chq|cheque|check)\b\.?\s*(?:no\b\.?|number\b|num\b\.?|#)?\s*[:\-–#]?\s*(?=\d)`, 'gi'),
  },
  {
    key: 'paymentAmount',
    re: new RegExp(String.raw`\b(?:payment|cheque)\s+amount\b${IN_BRACKETS}${SEP}${AMOUNT_AHEAD}`, 'gi'),
  },
  {
    key: 'amount',
    re: new RegExp(String.raw`\b(?:total\s+|net\s+)?amount\b(?!\s+in\s+words)${IN_BRACKETS}${SEP}${AMOUNT_AHEAD}`, 'gi'),
  },
  {
    key: 'datePayment',
    re: new RegExp(String.raw`\b(?:date\s+of\s+payment|payment\s+date|cheque\s+date)\b${SEP}${DATE_AHEAD}`, 'gi'),
  },
  {
    key: 'dateRequisition',
    re: new RegExp(String.raw`\bdate\s+of\s+requisition(?:ing)?\b${SEP}${DATE_AHEAD}`, 'gi'),
  },
  { key: 'date', re: new RegExp(String.raw`\bdate\b${SEP}${DATE_AHEAD}`, 'gi') },
  {
    key: 'stop',
    re: new RegExp(
      String.raw`\b(?:details?|description|particulars|narration|purpose|prepared\s+by|requested\s+by|checked\s+by|approved\s+by|authori[sz]ed\s+by|received\s+by|signature|bank|account|a\/c|reference|ref|memo|invoice|department|dept|project|payment\s+method|payment\s+receipt)\b${COLON}`,
      'gi'
    ),
  },
];

interface LabelHit {
  key: LabelKey;
  start: number;
  end: number;
}

function findLabels(line: string): LabelHit[] {
  const hits: LabelHit[] = [];
  for (const { key, re, needsBoundary } of LABELS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (needsBoundary) {
        const hasColon = /[:]\s*$/.test(m[0]);
        const before = line.slice(0, m.index);
        const setApart = before.trim() === '' || /\s{2,}$/.test(before);
        if (!hasColon && !setApart) continue;
      }
      hits.push({ key, start: m.index, end: m.index + m[0].length });
    }
  }
  // Longest label wins where two overlap ("Payment Amount" beats "Amount").
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: LabelHit[] = [];
  for (const hit of hits) {
    const last = kept[kept.length - 1];
    if (last && hit.start < last.end) {
      if (hit.end - hit.start > last.end - last.start) kept[kept.length - 1] = hit;
      continue;
    }
    kept.push(hit);
  }
  return kept;
}

interface LabelValue {
  key: LabelKey;
  value: string;
  /** Nothing else follows the value on its line — it may run on to the next. */
  endsLine: boolean;
}

/** The text after a label, up to the next label, a column gap, or the end of the line. */
function labelValues(line: string): LabelValue[] {
  const hits = findLabels(line);
  return hits.map((hit, i) => {
    const rest = line.slice(hit.end, i + 1 < hits.length ? hits[i + 1].start : line.length).trim();
    const parts = rest.split(COLUMN_SPLIT);
    return { key: hit.key, value: parts[0].trim(), endsLine: i + 1 === hits.length && parts.length === 1 };
  });
}

// ---- Individual fields -----------------------------------------------------------

const AMOUNT_ONLY = /^(?:kshs?|kes|shs?)?\.?\s*([\d,]+(?:\.\d{1,2})?(?:\/(?:=|-|\d{2})?)?=?)[.,;]?$/i;

/**
 * The value must be an amount and nothing else. "58 000.00" or "58.000,00"
 * is refused rather than read as 58.
 */
function amountFromValue(value: string): number | null {
  const m = value.trim().match(AMOUNT_ONLY);
  return m ? parseAmountToCents(m[1]) : null;
}

const CHQ_WORD = String.raw`\b(?:chq|cheque|check)\b\.?`;
const CHQ_MARK = String.raw`(?:no\b\.?|number\b|num\b\.?|#)`;
// "Cheque No. 585", "CHQ 000601". Without "No." at least three digits are needed.
const CHQ_INLINE = new RegExp(
  String.raw`${CHQ_WORD}\s*(?:${CHQ_MARK}\s*[:\-–#]?\s*(\d{1,12})|[:\-–#]?\s*(\d{3,12}))(?!\d)`,
  'gi'
);
// "... Cheque No." or "... Cheque" closing a table cell, its number wrapped to the next line.
const CHQ_OPEN = new RegExp(String.raw`${CHQ_WORD}\s*(${CHQ_MARK})?\s*[:\-–#]?\s*(?=$|\s{3,}|(?:kshs?|kes)\b)`, 'i');
const CHQ_REST = new RegExp(String.raw`^(${CHQ_MARK})?\s*[:\-–#]?\s*(\d{1,12})(?!\d)`, 'i');

function chequeNumbers(lines: string[]): string[] {
  const found: string[] = [];
  lines.forEach((line, i) => {
    CHQ_INLINE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CHQ_INLINE.exec(line))) found.push(m[1] ?? m[2]);

    const open = line.match(CHQ_OPEN);
    const next = lines[i + 1]?.split(COLUMN_SPLIT)[0].trim();
    if (open && next) {
      const rest = next.match(CHQ_REST);
      // "Cheque" then "No. 582", or "Cheque No." then "600" — but not "Cheque" then a bare number.
      if (rest && (open[1] || rest[1])) found.push(rest[2]);
    }
  });
  return found;
}

const stripZeros = (n: string) => n.replace(/^0+/, '');

// ---- Company name -------------------------------------------------------------

const CORPORATE = /\b(?:ltd|limited|plc|llp|inc|investments?|group|holdings?|enterprises?|company|co|properties|ventures|agencies|agents|developers|sacco|foundation|trust|partners|associates)\b\.?/i;
const TITLE = /cheque\s+requisition|payment\s+receipt|payment\s+voucher/i;
const REQUISITION_TITLE = /cheque\s+requisition\s+voucher|payment\s+receipt\s*:/i;

function cleanName(text: string): string {
  return text.replace(/^[\s\-–:,.]+|[\s\-–:,_]+$/g, '').replace(/\s+/g, ' ');
}

function companyFromHeader(lines: string[]): string {
  const titleAt = lines.findIndex((l) => TITLE.test(l));
  const firstLabelAt = lines.findIndex((l) => findLabels(l).some((h) => h.key !== 'stop'));

  let candidates: string[];
  if (titleAt > 0) {
    candidates = lines.slice(0, titleAt);
  } else {
    const end = firstLabelAt === -1 ? 6 : Math.min(firstLabelAt, 8);
    candidates = lines.slice(0, end).filter((l) => !TITLE.test(l));
  }

  for (const line of candidates) {
    for (const segment of line.split(COLUMN_SPLIT)) {
      if (CORPORATE.test(segment) && !TITLE.test(segment)) return cleanName(segment);
    }
  }
  const fallback = candidates.find((l) => /[a-z]{3,}/i.test(l) && !/\d{3,}/.test(l));
  return fallback ? cleanName(fallback.split(COLUMN_SPLIT)[0]) : '';
}

/** ERP receipts name the bank account the cheque is drawn on: "Bank: NCBA Bank -Sample Estate". */
function bankAccount(lines: string[]): string {
  for (const line of lines) {
    for (const segment of line.split(COLUMN_SPLIT)) {
      const m = segment.match(/^bank\s*:\s*(.+)$/i);
      if (m) return cleanName(m[1]);
    }
  }
  return '';
}

// ---- Main ---------------------------------------------------------------------

export interface ParseOptions {
  /** The day the document was produced (ISO), used to settle day/month order in dates. */
  producedOn?: string;
}

export interface ParsedRequisition {
  documentType: DocumentType;
  companyRaw: string;
  payee: string;
  dateRaw: string;
  date: string; // ISO or ''
  amountCents: number; // 0 = not found
  amountWordsRaw: string;
  wordsCents: number | null;
  chequeNumber: string;
  /** Doubts a person must clear before this can print. */
  reviewNotes: string[];
  /** Later pages (1-based) that are themselves requisitions. */
  otherRequisitionPages: number[];
}

function detectType(lines: string[]): DocumentType {
  if (lines.some((l) => /cheque\s+requisition/i.test(l))) return 'requisition_voucher';
  if (lines.some((l) => /payment\s+receipt|payment\s+amount/i.test(l))) return 'payment_receipt';
  return 'unknown';
}

/**
 * pages = the lines of each page, as produced by buildLines(). Only the first
 * page is read: later pages are supporting papers (invoices, schedules) whose
 * amounts and dates must never leak into the cheque.
 */
export function parseRequisition(pages: string[][], options: ParseOptions = {}): ParsedRequisition {
  const lines = pages[0] ?? [];
  const documentType = detectType(lines);
  const reviewNotes: string[] = [];

  let payee = '';
  let words = '';
  const dates: Partial<Record<'datePayment' | 'dateRequisition' | 'date', string>> = {};
  const amounts: { specific: boolean; value: string; cents: number | null }[] = [];

  lines.forEach((line, i) => {
    for (const { key, value, endsLine } of labelValues(line)) {
      if (!value) continue;
      const next = lines[i + 1];
      const nextIsLoose = !!next && findLabels(next).length === 0 && !TITLE.test(next);

      if (key === 'payee' && !payee) {
        payee = cleanName(value);
        if (endsLine && nextIsLoose && /^[a-z]/i.test(next)) {
          reviewNotes.push(`The payee may run on to the next line ("${next.split(COLUMN_SPLIT)[0].trim()}"). Check it against the requisition.`);
        }
      } else if (key === 'words' && !words) {
        words = value;
        // The words often run on to a second line.
        if (!/\bonly\b/i.test(words) && nextIsLoose) {
          const joined = `${words} ${next.split(COLUMN_SPLIT)[0]}`;
          if (wordsToCents(joined) !== null) words = joined;
        }
        words = words.replace(/[\s_.]+$/, '');
      } else if (key === 'paymentAmount' || key === 'amount') {
        amounts.push({ specific: key === 'paymentAmount', value, cents: amountFromValue(value) });
      } else if ((key === 'datePayment' || key === 'dateRequisition' || key === 'date') && !dates[key]) {
        dates[key] = value;
      }
    }
  });

  // Amount: "Payment Amount" outranks a plain "Amount". All that are found must agree.
  let amountCents = 0;
  const ranked = amounts.some((a) => a.specific) ? amounts.filter((a) => a.specific) : amounts;
  if (ranked.length > 0) {
    const unreadable = ranked.find((a) => a.cents === null);
    const distinct = [...new Set(ranked.map((a) => a.cents))];
    if (unreadable) {
      reviewNotes.push(`The amount "${unreadable.value}" could not be read for certain. Enter it by hand.`);
    } else if (distinct.length > 1) {
      reviewNotes.push(`More than one amount is shown (${ranked.map((a) => a.value).join(', ')}). Enter the amount to pay.`);
    } else {
      amountCents = distinct[0] ?? 0;
    }
  }

  // Cheque number: every mention on the page must be the same number.
  let chequeNumber = '';
  const numbers = chequeNumbers(lines);
  const distinctNumbers = [...new Set(numbers.map(stripZeros))];
  if (distinctNumbers.length === 1) {
    chequeNumber = numbers[0];
  } else if (distinctNumbers.length > 1) {
    reviewNotes.push(`More than one cheque number is mentioned (${[...new Set(numbers)].join(', ')}). Enter the right one.`);
  }

  // Date: the payment date if there is one.
  const dateSource = dates.datePayment ?? dates.dateRequisition ?? dates.date ?? '';
  const dateRaw = findDateInText(dateSource) ?? '';
  let date = '';
  if (dateRaw) {
    const reading = readDate(dateRaw, options.producedOn);
    date = reading.iso;
    if (reading.note) reviewNotes.push(reading.note);
  }

  const wordsCents = words ? wordsToCents(words) : null;

  // Which cheque book: the voucher's heading, or on an ERP receipt the bank account named on it.
  const header = companyFromHeader(lines);
  const bank = documentType === 'payment_receipt' ? bankAccount(lines) : '';
  const companyRaw = bank ? (header ? `${bank} (${header})` : bank) : header;

  const otherRequisitionPages: number[] = [];
  pages.forEach((pageLines, index) => {
    // A second requisition has its own heading and its own payee. A receipt that
    // simply runs on to another page has neither.
    const hasTitle = pageLines.some((l) => REQUISITION_TITLE.test(l));
    const hasPayee = pageLines.some((l) => labelValues(l).some((v) => v.key === 'payee' && v.value));
    if (index > 0 && hasTitle && hasPayee) otherRequisitionPages.push(index + 1);
  });

  return {
    documentType,
    companyRaw,
    payee,
    dateRaw,
    date,
    amountCents,
    amountWordsRaw: words,
    wordsCents,
    chequeNumber,
    reviewNotes,
    otherRequisitionPages,
  };
}
