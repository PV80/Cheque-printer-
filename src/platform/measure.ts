import { FONT_STACKS, type Measure } from '../core/layout';

const PX_TO_MM = 25.4 / 96;
const cache = new Map<string, number>();
let context: CanvasRenderingContext2D | null = null;

/** Real text width in mm, using the same fonts the printer page will use. */
export const measureText: Measure = (text, fontPt, fontFamily, fontWeight) => {
  const key = `${fontWeight}|${fontPt}|${fontFamily}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  context ??= document.createElement('canvas').getContext('2d');
  if (!context) return text.length * fontPt * 0.2; // no canvas: rough estimate
  context.font = `${fontWeight} ${fontPt}pt ${FONT_STACKS[fontFamily]}`;
  const width = context.measureText(text).width * PX_TO_MM;

  if (cache.size > 5000) cache.clear();
  cache.set(key, width);
  return width;
};
