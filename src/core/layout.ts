// Where each piece of text lands on the cheque.
//
// One function (layoutCheque) decides positions, font sizes and line breaks.
// The printer, the test print and the on-screen preview all use its result,
// so what you see is what prints.

import { amountToWords, formatFigures } from './amount';
import { formatDate } from './dates';
import type { ChequeTemplate, CompanyProfile, FieldKey, FieldPosition, FontFamily } from './types';

/** Width of a piece of text in mm, at a given font. Supplied by the caller. */
export type Measure = (text: string, fontPt: number, fontFamily: FontFamily, fontWeight: string) => number;

export const MIN_FONT_PT = 7;
export const FIELD_KEYS: FieldKey[] = ['date', 'payee', 'amountFigures', 'amountWords'];
const PT_TO_MM = 25.4 / 72;
const LINE_BOX = 1.2; // line box height as a multiple of the font size
const FIT_MARGIN = 0.98;

export const FONT_STACKS: Record<FontFamily, string> = {
  Arial: "Arial, Helvetica, 'Liberation Sans', sans-serif",
  'Courier New': "'Courier New', Courier, 'Liberation Mono', monospace",
  'Times New Roman': "'Times New Roman', Times, 'Liberation Serif', serif",
};

// Starting positions estimated from photos of an NCBA Kenya cheque. "Pay",
// "Kenya Shillings", "Ksh" and "Date" are pre-printed; only the values after
// them are printed. Every company must be checked with a test print.
export const DEFAULT_TEMPLATE: ChequeTemplate = {
  chequeWidth: 215,
  chequeHeight: 85,
  pageTopOffset: 0,
  fields: {
    date: { x: 148, y: 12, width: 62, fontSize: 11, fontFamily: 'Arial', fontWeight: 'normal', align: 'left' },
    payee: { x: 22, y: 34, width: 128, fontSize: 11, fontFamily: 'Arial', fontWeight: 'normal', align: 'left' },
    amountFigures: { x: 159, y: 34, width: 52, fontSize: 11, fontFamily: 'Arial', fontWeight: 'bold', align: 'left' },
    amountWords: {
      x: 44, y: 46, width: 163, height: 18, fontSize: 11, fontFamily: 'Arial', fontWeight: 'normal',
      align: 'left', wrap: true, lineSpacing: 8.5,
    },
  },
};

export interface PlacedLine {
  text: string;
  xMm: number;
  yMm: number;
}

export interface PlacedField {
  key: FieldKey;
  lines: PlacedLine[];
  widthMm: number;
  lineHeightMm: number;
  fontPt: number;
  fontFamily: FontFamily;
  fontWeight: 'normal' | 'bold';
  align: 'left' | 'center' | 'right';
  /** True when the text does not fit even at the smallest font. Never print these. */
  overflow: boolean;
}

export interface ChequeLayout {
  fields: PlacedField[];
  overflow: FieldKey[];
}

export type ChequeValues = Record<FieldKey, string>;

export function chequeValues(cheque: { date: string; payee: string; amountCents: number }): ChequeValues {
  return {
    date: formatDate(cheque.date),
    payee: cheque.payee,
    amountFigures: formatFigures(cheque.amountCents),
    amountWords: cheque.amountCents > 0 ? amountToWords(cheque.amountCents) : '',
  };
}

function wrapWords(text: string, maxWidth: number, widthOf: (t: string) => number): { lines: string[]; ok: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let ok = true;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (widthOf(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (widthOf(word) > maxWidth) ok = false; // a single word wider than the field
  }
  if (line) lines.push(line);
  return { lines, ok };
}

function placeField(key: FieldKey, text: string, f: FieldPosition, originX: number, originY: number, measure: Measure): PlacedField {
  const maxWidth = f.width * FIT_MARGIN;
  const base = {
    key,
    widthMm: f.width,
    fontFamily: f.fontFamily,
    fontWeight: f.fontWeight,
    align: f.align,
  };
  const x = f.x + originX;
  const y = f.y + originY;
  const sizes: number[] = [];
  for (let s = f.fontSize; s > MIN_FONT_PT; s -= 0.5) sizes.push(s);
  sizes.push(Math.min(f.fontSize, MIN_FONT_PT));

  let last: PlacedField | null = null;
  for (const size of sizes) {
    const lineHeightMm = size * LINE_BOX * PT_TO_MM;
    const widthOf = (t: string) => measure(t, size, f.fontFamily, f.fontWeight);

    if (!f.wrap) {
      const fits = text === '' || widthOf(text) <= maxWidth;
      last = { ...base, fontPt: size, lineHeightMm, overflow: !fits, lines: text ? [{ text, xMm: x, yMm: y }] : [] };
      if (fits) return last;
      continue;
    }

    const spacing = f.lineSpacing && f.lineSpacing > 0 ? f.lineSpacing : lineHeightMm;
    const available = f.height && f.height > 0 ? f.height : spacing + lineHeightMm;
    const maxLines = Math.max(1, Math.floor((available - lineHeightMm) / spacing + 1e-6) + 1);
    const wrapped = wrapWords(text, maxWidth, widthOf);
    const fits = wrapped.ok && wrapped.lines.length <= maxLines;
    last = {
      ...base,
      fontPt: size,
      lineHeightMm,
      overflow: !fits,
      lines: wrapped.lines.map((t, i) => ({ text: t, xMm: x, yMm: y + i * spacing })),
    };
    if (fits) return last;
  }
  return last!;
}

/** Positions every field of one cheque, shrinking text that would not fit. */
export function layoutCheque(
  values: ChequeValues,
  company: Pick<CompanyProfile, 'template' | 'printerOffsetX' | 'printerOffsetY'>,
  measure: Measure
): ChequeLayout {
  const t = company.template;
  const originX = company.printerOffsetX;
  const originY = company.printerOffsetY + t.pageTopOffset;
  const fields = FIELD_KEYS.map((key) => placeField(key, values[key].trim(), t.fields[key], originX, originY, measure));
  return { fields, overflow: fields.filter((f) => f.overflow).map((f) => f.key) };
}

export function pageSizeMm(template: ChequeTemplate): { widthMm: number; heightMm: number } {
  return { widthMm: template.chequeWidth, heightMm: template.chequeHeight + template.pageTopOffset };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const mm = (n: number) => `${Math.round(n * 1000) / 1000}mm`;

/** The exact page sent to the printer: one sheet per cheque, text only. */
export function buildPrintHtml(
  layouts: ChequeLayout[],
  template: ChequeTemplate,
  options: { title: string; guides?: boolean }
): string {
  const { widthMm, heightMm } = pageSizeMm(template);

  const pages = layouts
    .map((layout) => {
      const lines = layout.fields
        .flatMap((f) =>
          f.lines.map(
            (line) =>
              `<div class="l" style="left:${mm(line.xMm)};top:${mm(line.yMm)};width:${mm(f.widthMm)};` +
              `height:${mm(f.lineHeightMm)};line-height:${mm(f.lineHeightMm)};font-size:${f.fontPt}pt;` +
              `font-family:${FONT_STACKS[f.fontFamily]};font-weight:${f.fontWeight};text-align:${f.align}">` +
              `${escapeHtml(line.text)}</div>`
          )
        )
        .join('\n');
      const guides = options.guides
        ? `<div class="g" style="top:${mm(template.pageTopOffset)}"></div>` +
          `<div class="g" style="top:${mm(heightMm - 0.3)}"></div>`
        : '';
      return `<div class="page">${guides}\n${lines}\n</div>`;
    })
    .join('\n');

  // The page box is a hair shorter than the sheet so rounding can never
  // push a blank extra page out of the printer.
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${escapeHtml(options.title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:${mm(widthMm)} ${mm(heightMm)};margin:0}
html,body{width:${mm(widthMm)};background:#fff}
.page{position:relative;width:${mm(widthMm)};height:${mm(heightMm - 0.2)};overflow:hidden;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.l{position:absolute;white-space:pre;overflow:visible;color:#000}
.g{position:absolute;left:0;right:0;border-top:0.3pt dashed #999}
</style></head><body>
${pages}
</body></html>`;
}
