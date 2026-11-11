// Reading requisition PDFs: text for the cheque details, pixels for the signature box.
// Everything runs on this computer; the worker and fonts are bundled with the app.

import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { buildLines, type TextItem } from '../core/parser';
import { analyseSignatureZone, type InkAnalysis, type Rect } from '../core/signature';
import type { SignatureZone } from '../core/types';

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

const NOT_SIGNED: InkAnalysis = { signed: false, inkMm2: 0, widthMm: 0, heightMm: 0 };

/** Looks inside the signature box of a requisition for a signature-sized mark. */
export async function checkSignature(pdf: PdfDocument, zone: SignatureZone): Promise<InkAnalysis> {
  if (zone.page < 1 || zone.page > pdf.numPages) return NOT_SIGNED;

  const { canvas, scale } = await renderPage(pdf, zone.page, SIGNATURE_SCALE);
  const x = Math.max(0, Math.floor(zone.x * canvas.width));
  const y = Math.max(0, Math.floor(zone.y * canvas.height));
  const width = Math.min(canvas.width - x, Math.ceil(zone.w * canvas.width));
  const height = Math.min(canvas.height - y, Math.ceil(zone.h * canvas.height));
  if (width <= 0 || height <= 0) return NOT_SIGNED;

  const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, width, height);

  let maskRects: Rect[] = [];
  if (zone.ignoreTypedText) {
    const page = await pdf.getPage(zone.page);
    const pad = 0.6 * POINTS_PER_MM * scale;
    maskRects = (await pageText(page, scale))
      .filter((t) => t.str.trim() !== '')
      .map((t) => ({
        x: t.x - pad - x,
        y: t.y - t.height - pad - y,
        w: t.scaledWidth + 2 * pad,
        h: t.height * 1.35 + 2 * pad,
      }));
  }

  return analyseSignatureZone({ data: pixels.data, width, height, pxPerMm: POINTS_PER_MM * scale, maskRects });
}
