// Signature presence check.
//
// Looks at the pixels of the signature box on a rendered requisition and
// decides whether somebody has written in it. It does NOT recognise whose
// signature it is — any drawn mark, pasted image or stamp of signature size
// counts as "signed".

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ZonePixels {
  data: Uint8ClampedArray | Uint8Array; // RGBA, row by row
  width: number;
  height: number;
  pxPerMm: number;
  /** Areas to ignore, in zone pixels — e.g. where typed text sits. */
  maskRects?: Rect[];
}

export interface InkAnalysis {
  signed: boolean;
  inkMm2: number;
  widthMm: number;
  heightMm: number;
}

/** A mark must be at least this big to count as a signature. */
export const SIGNATURE_MINIMUM = { inkMm2: 3, widthMm: 6, heightMm: 2.5 };

/** Straight runs at least this long (mm) are treated as printed lines, not ink. */
const STRAIGHT_RUN_MM = { horizontal: 5, vertical: 4 };

const INK_CONTRAST = 48; // how far a pixel must be from the background colour (0-255)

function medianOfHistogram(hist: Uint32Array, total: number): number {
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen * 2 >= total) return v;
  }
  return 255;
}

export function analyseSignatureZone(zone: ZonePixels): InkAnalysis {
  const { data, width, height, pxPerMm } = zone;
  const total = width * height;
  const none: InkAnalysis = { signed: false, inkMm2: 0, widthMm: 0, heightMm: 0 };
  if (total === 0 || pxPerMm <= 0 || data.length < total * 4) return none;

  // 1. Background colour = the most typical colour in the box (usually white paper).
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < total; i++) {
    hist[0][data[i * 4]]++;
    hist[1][data[i * 4 + 1]]++;
    hist[2][data[i * 4 + 2]]++;
  }
  const bg = hist.map((h) => medianOfHistogram(h, total));

  // 2. Ink = anything clearly different from the background.
  const ink = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const d = Math.max(
      Math.abs(data[i * 4] - bg[0]),
      Math.abs(data[i * 4 + 1] - bg[1]),
      Math.abs(data[i * 4 + 2] - bg[2])
    );
    if (d >= INK_CONTRAST) ink[i] = 1;
  }

  // 3. Ignore typed text (labels, printed names).
  for (const r of zone.maskRects ?? []) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width, Math.ceil(r.x + r.w));
    const y1 = Math.min(height, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) ink.fill(0, y * width + x0, y * width + Math.max(x0, x1));
  }

  // 4. Ignore ruled lines, underlines and box or table borders: perfectly
  //    straight runs. Handwriting is never this straight for this long.
  const minHorizontal = STRAIGHT_RUN_MM.horizontal * pxPerMm;
  const minVertical = STRAIGHT_RUN_MM.vertical * pxPerMm;
  const erase = new Uint8Array(total);

  for (let y = 0; y < height; y++) {
    let runStart = -1;
    for (let x = 0; x <= width; x++) {
      const on = x < width && ink[y * width + x] === 1;
      if (on && runStart === -1) runStart = x;
      if (!on && runStart !== -1) {
        if (x - runStart >= minHorizontal) erase.fill(1, y * width + runStart, y * width + x);
        runStart = -1;
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let runStart = -1;
    for (let y = 0; y <= height; y++) {
      const on = y < height && ink[y * width + x] === 1;
      if (on && runStart === -1) runStart = y;
      if (!on && runStart !== -1) {
        if (y - runStart >= minVertical) for (let k = runStart; k < y; k++) erase[k * width + x] = 1;
        runStart = -1;
      }
    }
  }

  // 5. Measure what is left.
  const rowInk = new Uint32Array(height);
  const colInk = new Uint32Array(width);
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (ink[i] === 1 && erase[i] === 0) {
        count++;
        rowInk[y]++;
        colInk[x]++;
      }
    }
  }
  if (count === 0) return none;

  // How much of the box is actually written on, counted row by row and column
  // by column. Two thin marks far apart do not add up to one tall mark.
  const inked = (counts: Uint32Array, atLeast: number): number => {
    let n = 0;
    for (let i = 0; i < counts.length; i++) if (counts[i] >= atLeast) n++;
    return n;
  };

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const inkMm2 = round1(count / (pxPerMm * pxPerMm));
  const widthMm = round1(inked(colInk, 1) / pxPerMm);
  const heightMm = round1(inked(rowInk, 2) / pxPerMm);

  const signed =
    inkMm2 >= SIGNATURE_MINIMUM.inkMm2 &&
    widthMm >= SIGNATURE_MINIMUM.widthMm &&
    heightMm >= SIGNATURE_MINIMUM.heightMm;

  return { signed, inkMm2, widthMm, heightMm };
}
