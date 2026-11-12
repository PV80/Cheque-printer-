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
const EDGE_MM = 0.01; // rounding allowance when testing against an edge

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
  /** True when the field cannot be printed as placed (see problem). Never print these. */
  overflow: boolean;
  problem?: FieldProblem;
}

export type SheetEdge = 'top' | 'bottom' | 'left' | 'right';

/** Why a field must not be printed. */
export type FieldProblem =
  /** The text does not fit its space even at the smallest font. */
  | { kind: 'too_long' }
  /** The layout puts the text over the edge of the cheque itself. */
  | { kind: 'off_cheque' }
  /** On the cheque, but outside the sheet the printer is given, so it would be left out. */
  | { kind: 'off_sheet'; edge: SheetEdge; byMm: number };

const FIELD_NAMES: Record<FieldKey, string> = {
  date: 'date',
  payee: 'payee',
  amountFigures: 'amount',
  amountWords: 'amount in words',
};

export function fieldName(key: FieldKey): string {
  return FIELD_NAMES[key];
}

/** "7.1 mm above the top of the sheet" */
export function describeOffSheet(problem: { edge: SheetEdge; byMm: number }): string {
  const where = { top: 'above the top', bottom: 'below the bottom', left: 'past the left edge', right: 'past the right edge' }[problem.edge];
  return `${problem.byMm} mm ${where} of the sheet`;
}

export interface ChequeLayout {
  /** Positions as the cheque is read, measured on the sheet the printer is given. */
  fields: PlacedField[];
  overflow: FieldKey[];
  /** True when the printer turns all of it half a turn about the centre of the cheque. */
  rotated: boolean;
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
  const page = pageSizeMm(t);
  const rotated = t.rotate180 === true;
  const pivot = chequePivotMm(t);
  const fields = FIELD_KEYS.map((key): PlacedField => {
    const field = placeField(key, values[key].trim(), t.fields[key], originX, originY, measure);
    if (field.overflow) return { ...field, problem: { kind: 'too_long' } };

    let offCheque = false;
    let worst: { edge: SheetEdge; byMm: number } | null = null;
    for (const line of field.lines) {
      // Where the ink of this line really is, on the sheet the printer is given.
      const textWidth = measure(line.text, field.fontPt, field.fontFamily, field.fontWeight);
      const slack = field.widthMm - textWidth;
      const left = line.xMm + (field.align === 'right' ? slack : field.align === 'center' ? slack / 2 : 0);
      const right = left + textWidth;
      const top = line.yMm;
      const bottom = top + field.lineHeightMm;

      // The same line on the cheque itself: the printer shift does not move the leaf.
      if (
        left - originX < -EDGE_MM ||
        right - originX > t.chequeWidth + EDGE_MM ||
        top - originY < -EDGE_MM ||
        bottom - originY > t.chequeHeight + EDGE_MM
      ) {
        offCheque = true;
      }

      // Upside down, the printer turns everything half a turn about the centre of the cheque.
      const sheetLeft = rotated ? 2 * pivot.xMm - right : left;
      const sheetRight = rotated ? 2 * pivot.xMm - left : right;
      const sheetTop = rotated ? 2 * pivot.yMm - bottom : top;
      const sheetBottom = rotated ? 2 * pivot.yMm - top : bottom;

      // Anything outside the sheet is silently left out by the printer.
      const over: [SheetEdge, number][] = [
        ['top', -sheetTop],
        ['bottom', sheetBottom - page.heightMm],
        ['left', -sheetLeft],
        ['right', sheetRight - page.widthMm],
      ];
      for (const [edge, byMm] of over) {
        if (byMm > EDGE_MM && (!worst || byMm > worst.byMm)) worst = { edge, byMm };
      }
    }
    if (offCheque) return { ...field, overflow: true, problem: { kind: 'off_cheque' } };
    if (worst) {
      return { ...field, overflow: true, problem: { kind: 'off_sheet', edge: worst.edge, byMm: Math.round(worst.byMm * 10) / 10 } };
    }
    return field;
  });
  return { fields, overflow: fields.filter((f) => f.overflow).map((f) => f.key), rotated };
}

/** The centre of the cheque on the sheet: what an upside-down print turns about. */
export function chequePivotMm(template: ChequeTemplate): { xMm: number; yMm: number } {
  return { xMm: template.chequeWidth / 2, yMm: template.pageTopOffset + template.chequeHeight / 2 };
}

/**
 * The sheet the printer is told about. It starts as the cheque (plus any
 * carrier strip above it) and can be made longer for printers that will not
 * take a sheet as short as a cheque; the cheque stays at the top.
 */
export function pageSizeMm(template: ChequeTemplate): { widthMm: number; heightMm: number } {
  return {
    widthMm: template.chequeWidth,
    heightMm: Math.max(template.chequeHeight + template.pageTopOffset, template.sheetHeight ?? 0),
  };
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
          `<div class="g" style="top:${mm(Math.min(heightMm - 0.3, template.pageTopOffset + template.chequeHeight))}"></div>`
        : '';
      const pivot = chequePivotMm(template);
      const body = layout.rotated
        ? `<div class="r" style="transform-origin:${mm(pivot.xMm)} ${mm(pivot.yMm)}">\n${lines}\n</div>`
        : lines;
      return `<div class="page">${guides}\n${body}\n</div>`;
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
.r{position:absolute;left:0;top:0;width:100%;height:100%;transform:rotate(180deg)}
.g{position:absolute;left:0;right:0;border-top:0.3pt dashed #999}
</style></head><body>
${pages}
</body></html>`;
}
