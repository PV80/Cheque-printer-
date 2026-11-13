// Reading requisition PDFs: text for the cheque details, pixels for the signature box.
// Everything runs on this computer; the worker and fonts are bundled with the app.

import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { buildLines, type TextItem } from '../core/parser';
import { analyseSignatureZone, type InkAnalysis, type Rect } from '../core/signature';
import type { PageRange, SignatureZone } from '../core/types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const STANDARD_FONTS_URL = new URL('./pdfjs/standard_fonts/', document.baseURI).toString();
const POINTS_PER_MM = 72 / 25.4;
const SIGNATURE_SCALE = 2; // 144 dpi
const MAX_CANVAS_SIDE = 4000;

export type PdfDocument = PDFDocumentProxy;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  return pdfjsLib.getDocument({
    data: bytes.slice(), // pdf.js takes ownership of the buffer it is given
    standardFontDataUrl: STANDARD_FONTS_URL,
    isEvalSupported: false,
  }).promise;
}

interface PositionedText extends TextItem {
  /** Width at the scale of the viewport the item was measured in. */
  scaledWidth: number;
}

async function pageText(page: PDFPageProxy, scale: number): Promise<PositionedText[]> {
  const viewport = page.getViewport({ scale });
  const content = await page.getTextContent();
  const items: PositionedText[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform) as number[];
    const height = Math.hypot(tx[2], tx[3]) || item.height * scale;
    items.push({ str: item.str, x: tx[4], y: tx[5], width: item.width * scale, scaledWidth: item.width * scale, height });
  }
  return items;
}

/** The text of each page as visual lines, top to bottom. */
export async function extractPages(pdf: PdfDocument): Promise<string[][]> {
  const pages: string[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    pages.push(buildLines(await pageText(page, 1)));
  }
  return pages;
}

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  scale: number;
}

export async function renderPage(pdf: PdfDocument, pageNumber: number, wantedScale: number): Promise<RenderedPage> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(wantedScale, MAX_CANVAS_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not draw the page');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, scale };
}

/** The day the PDF was last saved, as ISO, from its own properties. */
export async function producedOn(pdf: PdfDocument): Promise<string | undefined> {
  try {
    const { info } = (await pdf.getMetadata()) as { info: { ModDate?: string; CreationDate?: string } };
    const stamp = (info.ModDate || info.CreationDate || '').match(/^D:(\d{4})(\d{2})(\d{2})/);
    return stamp ? `${stamp[1]}-${stamp[2]}-${stamp[3]}` : undefined;
  } catch {
    return undefined;
  }
}

const NOT_SIGNED: InkAnalysis = { signed: false, inkMm2: 0, widthMm: 0, heightMm: 0 };

// Underlines are often typed: "APPROVED BY: ____________". The words must be
// hidden completely, but the line only as a hairline, because the signature is
// written right across it.
const RULE_RUN = /([_.\-–—=]{4,})/;
const RULE_ONLY = /^[\s_.\-–—=]+$/;
let ruler: CanvasRenderingContext2D | null = null;

function textMasks(t: PositionedText, pad: number): Rect[] {
  const words = (x0: number, w: number): Rect => ({ x: x0 - pad, y: t.y - t.height - pad, w: w + 2 * pad, h: t.height * 1.35 + 2 * pad });
  const rule = (x0: number, w: number, dashes: boolean): Rect =>
    dashes
      ? { x: x0 - pad, y: t.y - 0.6 * t.height, w: w + 2 * pad, h: 0.6 * t.height } // "-----" sits mid-line
      : { x: x0 - pad, y: t.y - 0.2 * t.height, w: w + 2 * pad, h: 0.55 * t.height }; // "_____" sits on the baseline
  if (!RULE_RUN.test(t.str)) return [words(t.x, t.scaledWidth)];

  // Share the run's width between its words and its lines in proportion.
  ruler ??= document.createElement('canvas').getContext('2d');
  if (ruler) ruler.font = '10px Arial, Helvetica, sans-serif';
  const parts = t.str.split(RULE_RUN).filter((part) => part !== '');
  const widths = parts.map((part) => (ruler ? ruler.measureText(part).width : part.length));
  const total = widths.reduce((a, b) => a + b, 0) || 1;

  const rects: Rect[] = [];
  let left = t.x;
  parts.forEach((part, i) => {
    const w = (widths[i] / total) * t.scaledWidth;
    if (part.trim() !== '') rects.push(RULE_ONLY.test(part) ? rule(left, w, /[\-–—=]/.test(part)) : words(left, w));
    left += w;
  });
  return rects;
}

/** Looks inside the signature box of a requisition for a signature-sized mark. */
export interface LocatedZone {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

// The printed words a signature box is tied to. Only wording that labels a
// signature is used, never names, dates or amounts, which change every time.
// "Director's signature" is told apart from a bare "signature", which may be the employee's line.
const ANCHOR_PHRASE =
  /\b(?:approved by|authori[sz]ed by|signed by|checked by|(?:director|manager|approver|employer)['’]?s? signature|approved|authori[sz]ed|signature|signatory|sign)\b/;
const labelText = (s: string) => s.replace(/[_.\-–—=:]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

interface PageLabel {
  text: string; // the labelling phrase, e.g. "approved by"
  x: number; // where its line of text starts, as fractions of the page
  w: number; // how far that text runs, including the line to sign on if it is part of it
  y: number;
}

async function pageLabels(pdf: PdfDocument, pageNumber: number): Promise<PageLabel[]> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const labels: PageLabel[] = [];
  for (const t of await pageText(page, 1)) {
    const phrase = labelText(t.str).match(ANCHOR_PHRASE);
    if (phrase) labels.push({ text: phrase[0], x: t.x / viewport.width, y: t.y / viewport.height, w: t.width / viewport.width });
  }
  return labels;
}

/**
 * Finds the signature label nearest a box that has just been drawn, so the
 * box can follow that label on other copies of the form.
 */
export async function chooseAnchor(pdf: PdfDocument, at: LocatedZone): Promise<SignatureZone['anchor']> {
  const NEAR = 0.25; // of the page width
  // "Approved by" names the approver's place for certain; "Authorized" nearly so; a bare
  // "Sign" nearby may be someone else's line. Lower rank wins, then the nearer label.
  const rank = (label: PageLabel) =>
    label.text.endsWith(' by') || /^(?:director|manager|approver|employer)/.test(label.text) ? 0 : /^(?:approved|authori[sz]ed)$/.test(label.text) ? 1 : 2;
  let best: { label: PageLabel; distance: number } | null = null;
  for (const label of await pageLabels(pdf, at.page)) {
    // A signature at the far end of "Signature: ____________" is still beside that label.
    const dx = Math.max(at.x - (label.x + label.w), 0, label.x - (at.x + at.w));
    const dy = Math.max(at.y - label.y, 0, label.y - (at.y + at.h));
    const distance = Math.hypot(dx, dy);
    if (distance > NEAR) continue;
    const better = !best || (rank(label) !== rank(best.label) ? rank(label) < rank(best.label) : distance < best.distance);
    if (better) best = { label, distance };
  }
  return best ? { text: best.label.text, dx: at.x - best.label.x, dy: at.y - best.label.y } : undefined;
}

/**
 * Where a saved box sits on this particular document. A box tied to a label
 * is placed beside that label wherever it is — lower down, or on another
 * page. Otherwise it stays where it was drawn.
 */
export async function locateZone(pdf: PdfDocument, zone: SignatureZone, within?: PageRange): Promise<LocatedZone> {
  // Inside one salary slip of a payroll, "page 2" means the slip's second page,
  // and the label is looked for on that slip's pages only.
  const first = within ? Math.max(1, within.from) : 1;
  const last = within ? Math.min(pdf.numPages, within.to) : pdf.numPages;
  const home = within ? first + zone.page - 1 : zone.page;
  const fixed: LocatedZone = { page: home, x: zone.x, y: zone.y, w: zone.w, h: zone.h };
  if (!zone.anchor) return fixed;

  const order = [home, ...Array.from({ length: last - first + 1 }, (_, i) => first + i).filter((n) => n !== home)];
  for (const page of order) {
    if (page < first || page > last) continue;
    const hits = (await pageLabels(pdf, page)).filter((l) => l.text === zone.anchor!.text);
    if (hits.length === 0) continue;
    // If the wording appears twice on the page, take the one that puts the box closest to where it was drawn.
    const place = (l: PageLabel) => ({ x: l.x + zone.anchor!.dx, y: l.y + zone.anchor!.dy });
    const off = (l: PageLabel) => Math.abs(place(l).x - zone.x) + Math.abs(place(l).y - zone.y);
    const hit = hits.reduce((a, b) => (off(b) < off(a) ? b : a));
    const clamp = (v: number, size: number) => Math.min(Math.max(0, v), Math.max(0, 1 - size));
    return { page, x: clamp(place(hit).x, zone.w), y: clamp(place(hit).y, zone.h), w: zone.w, h: zone.h };
  }
  return fixed;
}

/** Reads one box at a known place on a known page. */
async function readBox(pdf: PdfDocument, zone: LocatedZone, ignoreTypedText: boolean): Promise<InkAnalysis> {
  if (zone.page < 1 || zone.page > pdf.numPages) return NOT_SIGNED;

  const { canvas, scale } = await renderPage(pdf, zone.page, SIGNATURE_SCALE);
  const x = Math.max(0, Math.floor(zone.x * canvas.width));
  const y = Math.max(0, Math.floor(zone.y * canvas.height));
  const width = Math.min(canvas.width - x, Math.ceil(zone.w * canvas.width));
  const height = Math.min(canvas.height - y, Math.ceil(zone.h * canvas.height));
  if (width <= 0 || height <= 0) return NOT_SIGNED;

  const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, width, height);

  let maskRects: Rect[] = [];
  if (ignoreTypedText) {
    const page = await pdf.getPage(zone.page);
    const pad = 0.6 * POINTS_PER_MM * scale;
    maskRects = (await pageText(page, scale))
      .filter((t) => t.str.trim() !== '')
      .flatMap((t) => textMasks(t, pad))
      .map((r) => ({ ...r, x: r.x - x, y: r.y - y }));

    // Text typed into the PDF afterwards (a text box or form field) is not a signature either.
    const viewport = page.getViewport({ scale });
    for (const a of await page.getAnnotations()) {
      const typed = a.subtype === 'FreeText' || (a.subtype === 'Widget' && a.fieldType === 'Tx');
      if (!typed || !Array.isArray(a.rect)) continue;
      const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
      maskRects.push({ x: Math.min(x1, x2) - x, y: Math.min(y1, y2) - y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
    }
  }

  return analyseSignatureZone({ data: pixels.data, width, height, pxPerMm: POINTS_PER_MM * scale, maskRects });
}

/** Looks inside one signature box of a requisition for a signature-sized mark. */
export async function checkSignature(pdf: PdfDocument, zone: SignatureZone, within?: PageRange): Promise<InkAnalysis> {
  const at = await locateZone(pdf, zone, within);
  if (within && (at.page < within.from || at.page > within.to)) return NOT_SIGNED;
  return readBox(pdf, at, zone.ignoreTypedText);
}

/** A form may be signed in more than one place: a signature in any of its boxes counts. */
export async function checkSignatureBoxes(pdf: PdfDocument, zones: SignatureZone[], within?: PageRange): Promise<InkAnalysis> {
  let best = NOT_SIGNED;
  for (const zone of zones) {
    const result = await checkSignature(pdf, zone, within);
    if (result.signed) return result;
    if (result.inkMm2 > best.inkMm2) best = result;
  }
  return best;
}
