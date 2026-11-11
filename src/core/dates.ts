// Cheque dates. Stored as ISO "YYYY-MM-DD", printed as DD/MM/YYYY (day first, Kenya).

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toIso(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isValidIsoDate(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return !!m && toIso(+m[1], +m[2], +m[3]) === iso;
}

/** Reads the common ways a date is written. Returns ISO, or null if not a real date. */
export function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/))) return toIso(+m[1], +m[2], +m[3]);

  if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/))) return toIso(+m[3], +m[2], +m[1]);

  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([a-z]{3,9})\.?,?[\s\-/.]+(\d{4}|\d{2})$/i))) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? toIso(+m[3], month, +m[1]) : null;
  }

  if ((m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i))) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? toIso(+m[3], month, +m[2]) : null;
  }

  return null;
}

// Each form must start and end on a clean edge, so "2026/06/25" is never read
// from its middle as "26/06/25".
const EDGE_BEFORE = String.raw`(?<![\d/.\-])`;
const EDGE_AFTER = String.raw`(?![\d/\-]|\.\d)`;
const DATE_IN_TEXT = new RegExp(
  [
    String.raw`${EDGE_BEFORE}\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}${EDGE_AFTER}`,
    String.raw`${EDGE_BEFORE}\d{1,2}[/\-.]\d{1,2}[/\-.](?:\d{4}|\d{2})${EDGE_AFTER}`,
    String.raw`${EDGE_BEFORE}\d{1,2}(?:st|nd|rd|th)?[\s\-/.]+[A-Za-z]{3,9}\.?,?[\s\-/.]+(?:\d{4}|\d{2})${EDGE_AFTER}`,
    String.raw`\b[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}${EDGE_AFTER}`,
  ].join('|')
);

/** Finds the first thing that looks like a date in a piece of text. */
export function findDateInText(text: string): string | null {
  const m = text.match(DATE_IN_TEXT);
  return m ? m[0] : null;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "10 November 2026" — unmistakable, for asking a person which date is meant. */
export function formatDateLong(iso: string): string {
  if (!isValidIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

function daysBetween(a: string, b: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.abs(utc(a) - utc(b)) / 86_400_000;
}

export interface DateReading {
  iso: string; // '' when the date cannot be settled
  note: string; // why not, in words a person can act on
}

const NEAR_DAYS = 10;
const CLEAR_GAP_DAYS = 15;

/**
 * Reads a date from a requisition. Forms arrive with both day-first
 * (10/11/2026 = 10 November) and month-first (10/13/2026 = 13 October) dates,
 * so an all-number date is only accepted when it can be just one thing:
 * either one reading is impossible, or one reading falls within a few days of
 * when the document was produced and the other is clearly far off.
 */
export function readDate(raw: string, producedOn: string | undefined): DateReading {
  const s = raw.trim().replace(/\s+/g, ' ');
  const numeric = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/);
  if (!numeric) {
    const iso = parseDate(s);
    return iso ? { iso, note: '' } : { iso: '', note: `The date "${raw}" could not be read.` };
  }

  const dayFirst = toIso(+numeric[3], +numeric[2], +numeric[1]);
  const monthFirst = toIso(+numeric[3], +numeric[1], +numeric[2]);
  if (!dayFirst && !monthFirst) return { iso: '', note: `The date "${raw}" is not a real date.` };
  if (!dayFirst || !monthFirst || dayFirst === monthFirst) return { iso: (dayFirst ?? monthFirst)!, note: '' };

  if (producedOn && isValidIsoDate(producedOn)) {
    const a = daysBetween(dayFirst, producedOn);
    const b = daysBetween(monthFirst, producedOn);
    if (Math.min(a, b) <= NEAR_DAYS && Math.abs(a - b) >= CLEAR_GAP_DAYS) {
      return { iso: a < b ? dayFirst : monthFirst, note: '' };
    }
  }
  return {
    iso: '',
    note: `The date ${raw} could be ${formatDateLong(dayFirst)} or ${formatDateLong(monthFirst)}. Enter the right one.`,
  };
}

/** DD/MM/YYYY, or '' when the date is missing or invalid. */
export function formatDate(iso: string): string {
  if (!isValidIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * A saved moment shown on this computer's clock: "05/06/2026 14:30".
 * Timestamps are stored in UTC, so they must not be read off the stored text.
 */
export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Just the day part of formatTimestamp: "05/06/2026". */
export function formatTimestampDate(iso: string | undefined): string {
  return formatTimestamp(iso).slice(0, 10);
}

/** Today's date on this computer's clock, as ISO. */
export function todayIso(now: Date = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate()) ?? '';
}

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return toIso(year, month, Math.min(d, daysInMonth(year, month))) ?? iso;
}

export type DateWarning = 'post_dated' | 'stale';

/** Banks refuse cheques dated in the future or more than six months ago. */
export function dateWarning(iso: string, today: string): DateWarning | null {
  if (!isValidIsoDate(iso) || !isValidIsoDate(today)) return null;
  if (iso > today) return 'post_dated';
  if (iso < addMonths(today, -6)) return 'stale';
  return null;
}
