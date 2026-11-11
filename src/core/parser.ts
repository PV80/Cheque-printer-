// Reads the cheque details out of a requisition's text.
//
// The PDF text arrives as positioned fragments. buildLines() rebuilds the
// visual lines; parseRequisition() then looks for labelled values on them.
// Anything it cannot find is left empty and the cheque is held for review —
// it never guesses.

import { parseAmountToCents, wordsToCents } from './amount';
import { findDateInText, parseDate } from './dates';
import type { DocumentType } from './types';

export interface TextItem {
  str: string;
  x: number; // left edge
  y: number; // baseline, measured downward from the top of the page
  width: number;
  height: number;
}

const COLUMN_GAP = '   ';

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

type LabelKey = 'words' | 'payee' | 'chq' | 'amount' | 'datePayment' | 'dateRequisition' | 'date' | 'stop';

const SEP = String.raw`\s*[:\-–]?\s*`;
const COLON = String.raw`\s*:\s*`;
const AMOUNT_AHEAD = String.raw`(?=(?:kshs?|kes|shs?)?\.?\s*\d)`;
const DATE_AHEAD = String.raw`(?=\d|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)`;

// A label only counts when what follows it has the right shape (digits after
// CHQ, a date after DATE...) or it is clearly set apart. That stops a payee
// called "Date Palm Supplies" or "Bank of Africa" from being cut short.
const LABELS: { key: LabelKey; re: RegExp; needsBoundary?: boolean }[] = [
  { key: 'words', re: new RegExp(String.raw`\bamount\s+in\s+words\b${SEP}`, 'gi'), needsBoundary: true },
  { key: 'words', re: new RegExp(String.raw`\b(?:kenya\s+)?shillings${COLON}`, 'gi') },
  { key: 'words', re: new RegExp(String.raw`^\s*(?:kenya\s+)?shillings\b${SEP}`, 'gi') },
  {
    key: 'payee',
    re: new RegExp(
      String.raw`\b(?:payee(?:['’]s)?(?:\s+name)?|pay(?:able)?\s+to|paid\s+to|vendor(?:\s+name)?|supplier(?:\s+name)?)\b${SEP}`,
      'gi'
    ),
    needsBoundary: true,
  },
  {
    key: 'chq',
    re: new RegExp(String.raw`\b(?:chq|cheque|check)\b\.?\s*(?:no\b\.?|number\b|num\b\.?|#)?\s*[:\-–#]?\s*(?=\d)`, 'gi'),
  },
  {
    key: 'amount',
    re: new RegExp(
      String.raw`\b(?:payment\s+|cheque\s+|total\s+|net\s+)?amount\b(?!\s+in\s+words)\s*(?:\(\s*(?:kshs?|kes)\.?\s*\))?${SEP}${AMOUNT_AHEAD}`,
      'gi'
    ),
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
      String.raw`\b(?:details|description|particulars|narration|purpose|prepared\s+by|requested\s+by|checked\s+by|approved\s+by|authori[sz]ed\s+by|received\s+by|signature|bank|account|a\/c|reference|ref|memo|invoice|department|dept|project|payment\s+method)\b${COLON}`,
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
  // Longest label wins where two overlap ("Date of Payment" beats "Date").
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

/** The text after a label, up to the next label, a column gap, or the end of the line. */
function labelValues(line: string): { key: LabelKey; value: string }[] {
  const hits = findLabels(line);
  return hits.map((hit, i) => {
    const until = i + 1 < hits.length ? hits[i + 1].start : line.length;
    const value = line.slice(hit.end, until).trim().split(/\s{3,}/)[0].trim();
    return { key: hit.key, value };
  });
}

// ---- Company name -------------------------------------------------------------

const CORPORATE = /\b(?:ltd|limited|plc|llp|inc|investments?|group|holdings?|enterprises?|company|co|properties|ventures|agencies|developers|sacco|foundation|trust|partners|associates)\b\.?/i;
const TITLE = /cheque\s+requisition|payment\s+receipt|payment\s+voucher/i;

function cleanName(text: string): string {
  return text.replace(/^[\s\-–:,.]+|[\s\-–:,]+$/g, '').replace(/\s+/g, ' ');
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
    for (const segment of line.split(/\s{3,}/)) {
      if (CORPORATE.test(segment) && !TITLE.test(segment)) return cleanName(segment);
    }
  }
  const fallback = candidates.find((l) => /[a-z]{3,}/i.test(l) && !/\d{3,}/.test(l));
  return fallback ? cleanName(fallback.split(/\s{3,}/)[0]) : '';
}

function companyFromBankLine(lines: string[]): string {
  // ERP receipts print "Bank: NCBA Bank - Company Name".
  for (const line of lines) {
    const m = line.match(/\bbank\s*[:\-–]\s*[a-z&.\s]*?\bbank\s*[-–]\s*(.+)/i);
    if (m) return cleanName(m[1].split(/\s{3,}/)[0]);
  }
  return '';
}

// ---- Main ---------------------------------------------------------------------

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
}

function detectType(lines: string[]): DocumentType {
  if (lines.some((l) => /cheque\s+requisition/i.test(l))) return 'requisition_voucher';
  if (lines.some((l) => /payment\s+receipt|payment\s+amount/i.test(l))) return 'payment_receipt';
  return 'unknown';
}

/** pages = the lines of each page, as produced by buildLines(). */
export function parseRequisition(pages: string[][]): ParsedRequisition {
  const allLines = pages.flat();
  const documentType = detectType(allLines);

  const found: Partial<Record<LabelKey, string>> = {};
  for (const lines of pages) {
    for (let i = 0; i < lines.length; i++) {
      for (const { key, value } of labelValues(lines[i])) {
        if (key === 'stop' || !value || found[key] !== undefined) continue;

        if (key === 'words') {
          // The words often run on to a second line.
          let words = value;
          const next = lines[i + 1];
          if (!/\bonly\b/i.test(words) && next && findLabels(next).length === 0) {
            const joined = `${words} ${next.split(/\s{3,}/)[0]}`;
            if (wordsToCents(joined) !== null) words = joined;
          }
          found.words = words;
        } else {
          found[key] = value;
        }
      }
    }
  }

  const chequeNumber = (found.chq?.match(/^\d{3,12}/) ?? [''])[0];

  const amountToken = found.amount?.match(/^(?:kshs?|kes|shs?)?\.?\s*[\d,]+(?:\.\d{1,2})?(?:\/(?:=|-|\d{2})?)?=?/i);
  const amountCents = amountToken ? parseAmountToCents(amountToken[0]) ?? 0 : 0;

  const dateSource = found.datePayment ?? found.dateRequisition ?? found.date ?? '';
  const dateRaw = findDateInText(dateSource) ?? '';
  const date = dateRaw ? parseDate(dateRaw) ?? '' : '';

  const amountWordsRaw = found.words ?? '';
  const wordsCents = amountWordsRaw ? wordsToCents(amountWordsRaw) : null;

  const firstPage = pages[0] ?? [];
  const companyRaw =
    (documentType === 'payment_receipt' ? companyFromBankLine(allLines) : '') || companyFromHeader(firstPage);

  return {
    documentType,
    companyRaw,
    payee: cleanName(found.payee ?? ''),
    dateRaw,
    date,
    amountCents,
    amountWordsRaw,
    wordsCents,
    chequeNumber,
  };
}
