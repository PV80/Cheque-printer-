import { describe, expect, it } from 'vitest';
import { analyseSignatureZone, type ZonePixels } from '../src/core/signature';

const PX_PER_MM = 5.67; // 144 dpi, as rendered by the app

type Rgb = [number, number, number];
const BLACK: Rgb = [0, 0, 0];
const BLUE: Rgb = [30, 50, 190];

/** A blank signature box, 60 x 20 mm by default. */
function box(widthMm = 60, heightMm = 20, paper: Rgb = [255, 255, 255]): ZonePixels {
  const width = Math.round(widthMm * PX_PER_MM);
  const height = Math.round(heightMm * PX_PER_MM);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...paper, 255], i * 4);
  return { data, width, height, pxPerMm: PX_PER_MM };
}

function dot(z: ZonePixels, x: number, y: number, colour: Rgb = BLACK): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= z.width || y >= z.height) return;
  (z.data as Uint8ClampedArray).set([...colour, 255], (y * z.width + x) * 4);
}

function rect(z: ZonePixels, x: number, y: number, w: number, h: number, colour: Rgb = BLACK): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) dot(z, xx, yy, colour);
}

/** A looping pen stroke, roughly `widthMm` wide and `heightMm` tall. */
function scribble(z: ZonePixels, startMm: number, widthMm: number, heightMm: number, colour: Rgb = BLACK): void {
  const midY = z.height / 2;
  const steps = Math.round(widthMm * PX_PER_MM * 6);
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const x = (startMm + t * widthMm) * PX_PER_MM;
    const y = midY + Math.sin(t * Math.PI * 9) * (heightMm / 2) * PX_PER_MM;
    rect(z, x, y, 2, 2, colour);
  }
}

describe('analyseSignatureZone', () => {
  it('blank box is not signed', () => {
    const result = analyseSignatureZone(box());
    expect(result).toEqual({ signed: false, inkMm2: 0, widthMm: 0, heightMm: 0 });
  });

  it('a pen signature is signed', () => {
    const z = box();
    scribble(z, 10, 35, 9);
    const result = analyseSignatureZone(z);
    expect(result.signed).toBe(true);
    expect(result.widthMm).toBeGreaterThan(30);
    expect(result.heightMm).toBeGreaterThan(7);
  });

  it('blue ink counts', () => {
    const z = box();
    scribble(z, 10, 35, 9, BLUE);
    expect(analyseSignatureZone(z).signed).toBe(true);
  });

  it('the printed signature line alone is not a signature', () => {
    const z = box();
    rect(z, 0, z.height - 12, z.width, 2);
    expect(analyseSignatureZone(z).signed).toBe(false);
  });

  it('a box border alone is not a signature', () => {
    const z = box();
    rect(z, 0, 0, z.width, 2);
    rect(z, 0, z.height - 2, z.width, 2);
    rect(z, 0, 0, 2, z.height);
    rect(z, z.width - 2, 0, 2, z.height);
    expect(analyseSignatureZone(z).signed).toBe(false);
  });

  it('a signature written across the printed line is still found', () => {
    const z = box();
    rect(z, 0, Math.round(z.height / 2), z.width, 2);
    scribble(z, 10, 35, 9);
    expect(analyseSignatureZone(z).signed).toBe(true);
  });

  it('a dotted line is not a signature', () => {
    const z = box();
    for (let x = 0; x < z.width; x += 6) rect(z, x, z.height - 12, 3, 1);
    const result = analyseSignatureZone(z);
    expect(result.signed).toBe(false);
  });

  it('a speck or a small tick is not a signature', () => {
    const z = box();
    rect(z, 100, 40, 5, 5);
    expect(analyseSignatureZone(z).signed).toBe(false);

    const tick = box();
    scribble(tick, 10, 3, 2);
    expect(analyseSignatureZone(tick).signed).toBe(false);
  });

  it('typed text is ignored when its area is masked', () => {
    const typed = () => {
      const z = box();
      // Something text-like: a row of small dark blocks, 30 x 3.5 mm.
      for (let i = 0; i < 20; i++) rect(z, 30 + i * 8, 40, 5, 20);
      return z;
    };
    expect(analyseSignatureZone(typed()).signed).toBe(true);
    const masked = typed();
    masked.maskRects = [{ x: 26, y: 36, w: 20 * 8 + 8, h: 28 }];
    expect(analyseSignatureZone(masked).signed).toBe(false);
  });

  it('works on tinted paper', () => {
    const blank = box(60, 20, [225, 230, 215]);
    expect(analyseSignatureZone(blank).signed).toBe(false);
    const signed = box(60, 20, [225, 230, 215]);
    scribble(signed, 10, 35, 9);
    expect(analyseSignatureZone(signed).signed).toBe(true);
  });

  it('light grey shading is not ink', () => {
    const z = box();
    rect(z, 0, 0, z.width, Math.round(z.height / 3), [232, 232, 232]);
    expect(analyseSignatureZone(z).signed).toBe(false);
  });

  it('small initials still count', () => {
    const z = box();
    scribble(z, 20, 8, 4);
    expect(analyseSignatureZone(z).signed).toBe(true);
  });

  it('an empty table cell is not a signature, whatever part of it is in the box', () => {
    const z = box(60, 20);
    // Cell sides that stop part-way down the box, and the cell's bottom edge.
    rect(z, 20, 0, 2, 45);
    rect(z, 220, 0, 2, 45);
    rect(z, 20, 45, 202, 2);
    expect(analyseSignatureZone(z).signed).toBe(false);
  });

  it('two printed underlines are not a signature', () => {
    const z = box(60, 20);
    // Underlines drawn with separate characters, leaving hairline gaps.
    for (const y of [20, 70]) for (let x = 10; x < z.width - 10; x += 9) rect(z, x, y, 8, 1);
    const result = analyseSignatureZone(z);
    expect(result.signed).toBe(false);
    expect(result.heightMm).toBeLessThan(1);
  });

  it('a short underline and a stub of a border are not a signature', () => {
    const z = box(60, 20);
    rect(z, 40, 90, 60, 2); // "Sign: ______"
    rect(z, 150, 30, 2, 20);
    expect(analyseSignatureZone(z).signed).toBe(false);
  });

  it('a signature written inside a table cell is still found', () => {
    const z = box(60, 20);
    rect(z, 5, 0, 2, z.height);
    rect(z, z.width - 7, 0, 2, z.height);
    rect(z, 0, z.height - 20, z.width, 3);
    scribble(z, 8, 40, 9, BLUE);
    expect(analyseSignatureZone(z).signed).toBe(true);
  });

  it('handles an empty or malformed zone', () => {
    expect(analyseSignatureZone({ data: new Uint8ClampedArray(0), width: 0, height: 0, pxPerMm: PX_PER_MM }).signed).toBe(false);
    expect(analyseSignatureZone({ data: new Uint8ClampedArray(4), width: 10, height: 10, pxPerMm: PX_PER_MM }).signed).toBe(false);
  });
});
