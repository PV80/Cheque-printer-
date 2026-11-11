// Money handling. All amounts are integer cents so nothing is ever rounded.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const MAX_WHOLE = 999_999_999_999; // just under one trillion shillings

function below1000(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rem = n % 10;
    return TENS[Math.floor(n / 10)] + (rem ? ' ' + ONES[rem] : '');
  }
  const rem = n % 100;
  return ONES[Math.floor(n / 100)] + ' Hundred' + (rem ? ' ' + below1000(rem) : '');
}

function wholeToWords(whole: number): string {
  const parts: string[] = [];
  const billions = Math.floor(whole / 1_000_000_000);
  const millions = Math.floor((whole % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((whole % 1_000_000) / 1_000);
  const remainder = whole % 1_000;

  if (billions) parts.push(below1000(billions) + ' Billion');
  if (millions) parts.push(below1000(millions) + ' Million');
  if (thousands) parts.push(below1000(thousands) + ' Thousand');
  if (remainder) parts.push(below1000(remainder));
  return parts.join(' ');
}

/** "Fifty Eight Thousand Only", "Fifteen Thousand and Fifty Cents Only". */
export function amountToWords(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0 || Math.floor(cents / 100) > MAX_WHOLE) {
    throw new Error('Amount out of range');
  }
  const whole = Math.floor(cents / 100);
  const c = cents % 100;
  if (whole === 0 && c === 0) return 'Zero Only';

  const parts: string[] = [];
  if (whole > 0) parts.push(wholeToWords(whole));
  if (c > 0) parts.push((whole > 0 ? 'and ' : '') + below1000(c) + (c === 1 ? ' Cent' : ' Cents'));
  return parts.join(' ') + ' Only';
}

function withCommas(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** Figures as written on a Kenyan cheque: "58,000/=" or "15,000.50". */
export function formatFigures(cents: number): string {
  const whole = Math.floor(cents / 100);
  const c = cents % 100;
  return withCommas(whole) + (c ? '.' + pad2(c) : '/=');
}

/** Figures for on-screen lists: "58,000.00". */
export function formatMoney(cents: number): string {
  return withCommas(Math.floor(cents / 100)) + '.' + pad2(cents % 100);
}

/**
 * Reads an amount as typed or printed: "15,000/=", "15,000/50", "KSh 58,000.00",
 * "15000". Returns cents, or null when the text is not a clean amount.
 */
export function parseAmountToCents(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/^(?:kshs?|kes|shs?)\.?\s*/i, '')
    .replace(/\s+/g, '')
    .replace(/[.,;]+$/, '');
  if (!s) return null;

  let wholeText: string;
  let cents = 0;

  const stroke = s.match(/^([\d,]+)\/(=|-|\d{2})?$/);
  const plain = s.match(/^([\d,]+)(?:\.(\d{1,2}))?=?$/);

  if (stroke) {
    wholeText = stroke[1];
    if (stroke[2] && /^\d{2}$/.test(stroke[2])) cents = parseInt(stroke[2], 10);
  } else if (plain) {
    wholeText = plain[1];
    if (plain[2]) cents = parseInt(plain[2].padEnd(2, '0'), 10);
  } else {
    return null;
  }

  // Commas must be proper thousands separators, or absent.
  if (!/^\d{1,3}(?:,\d{3})+$/.test(wholeText) && !/^\d+$/.test(wholeText)) return null;

  const whole = parseInt(wholeText.replace(/,/g, ''), 10);
  if (!Number.isFinite(whole) || whole > MAX_WHOLE) return null;
  return whole * 100 + cents;
}

// ---- Words back to a number, for cross-checking the requisition --------------

const WORD_VALUES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, ninty: 90,
};

const SCALES: Record<string, number> = {
  thousand: 1_000, thousands: 1_000,
  million: 1_000_000, millions: 1_000_000,
  billion: 1_000_000_000, billions: 1_000_000_000,
};

const NOISE = new Set(['and', 'only', 'kenya', 'kenyan', 'ksh', 'kshs', 'kes', 'sh', 'shs', 'a', 'of', 'the', 'sum']);
const SHILLING_WORDS = new Set(['shilling', 'shillings']);
const CENT_WORDS = new Set(['cent', 'cents', 'cts']);

function parseNumberWords(tokens: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const t of tokens) {
    if (t in WORD_VALUES) {
      current += WORD_VALUES[t];
    } else if (t === 'hundred' || t === 'hundreds') {
      current = (current || 1) * 100;
    } else if (t in SCALES) {
      total += (current || 1) * SCALES[t];
      current = 0;
    } else {
      return null;
    }
    seen = true;
  }
  return seen ? total + current : null;
}

const stripNoise = (tokens: string[]) => tokens.filter((t) => !NOISE.has(t) && !SHILLING_WORDS.has(t));

function combine(shillingTokens: string[], centTokens: string[]): number | null {
  const sh = stripNoise(shillingTokens);
  const ct = stripNoise(centTokens);
  const shillings = sh.length === 0 ? 0 : parseNumberWords(sh);
  const cents = parseNumberWords(ct);
  if (shillings === null || cents === null || cents < 0 || cents > 99) return null;
  return shillings * 100 + cents;
}

/**
 * Turns "Fifteen Thousand Shillings and Fifty Cents Only" into 1500050.
 * Returns null when the text cannot be read with confidence.
 */
export function wordsToCents(text: string): number | null {
  const tokens = text
    .toLowerCase()
    .replace(/[-–—/]/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const centsAt = tokens.findIndex((t) => CENT_WORDS.has(t));
  if (centsAt === -1) {
    const whole = parseNumberWords(stripNoise(tokens));
    return whole === null ? null : whole * 100;
  }

  const before = tokens.slice(0, centsAt);
  const after = stripNoise(tokens.slice(centsAt + 1));

  // "... Cents Fifty Only"
  if (after.length > 0) return combine(before, after);

  // "... Shillings and Fifty Cents": split at "shillings", else at the last "and".
  const candidates: number[] = [];
  let shillingsAt = -1;
  before.forEach((t, i) => {
    if (SHILLING_WORDS.has(t)) shillingsAt = i;
  });
  if (shillingsAt > 0) candidates.push(shillingsAt);
  const lastAnd = before.lastIndexOf('and');
  if (lastAnd !== -1) candidates.push(lastAnd);

  for (const at of candidates) {
    const result = combine(before.slice(0, at), before.slice(at + 1));
    if (result !== null) return result;
  }

  // No separator: the trailing tens/ones are the cents ("Fifteen Thousand Fifty Cents").
  const cleaned = stripNoise(before);
  for (const take of [2, 1]) {
    if (cleaned.length < take) continue;
    const tail = cleaned.slice(cleaned.length - take);
    if (!tail.every((t) => t in WORD_VALUES)) continue;
    const result = combine(cleaned.slice(0, cleaned.length - take), tail);
    if (result !== null) return result;
  }
  return null;
}
