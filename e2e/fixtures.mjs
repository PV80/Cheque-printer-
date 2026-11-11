// Builds sample requisition PDFs for the end-to-end test. All names and
// amounts are made up. The signature can be added the ways people really
// sign on screen: drawn strokes, a pasted image, or a pen annotation.

import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, rgb, StandardFonts } from 'pdf-lib';

export const PAGE = { w: 595, h: 842 }; // A4 in points

// Where the approver signs, in PDF points (origin bottom-left).
const SIGN_AREA = { x: 395, y: 188, w: 160, h: 58 };

/** The same area as fractions of the page measured from the top-left, as the app stores it. */
export const SIGNATURE_BOX = {
  x: SIGN_AREA.x / PAGE.w,
  y: (PAGE.h - SIGN_AREA.y - SIGN_AREA.h) / PAGE.h,
  w: SIGN_AREA.w / PAGE.w,
  h: SIGN_AREA.h / PAGE.h,
};

// ---- A tiny PNG encoder, for the "pasted signature image" case ------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function signaturePng() {
  const width = 300;
  const height = 90;
  const rgba = Buffer.alloc(width * height * 4); // fully transparent
  const ink = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = Math.round(x) + dx;
        const py = Math.round(y) + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        rgba.set([20, 20, 60, 255], (py * width + px) * 4);
      }
    }
  };
  for (let t = 0; t < 1; t += 0.0005) {
    ink(15 + t * 270, 45 + Math.sin(t * Math.PI * 7) * 30 * (1 - t * 0.4));
  }

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- The requisition ---------------------------------------------------------------

/**
 * @param {object} o
 * @param {string} o.company
 * @param {string} o.payee
 * @param {string} o.chq
 * @param {string} o.amount        figures as written, e.g. "58,000/="
 * @param {string} o.words         amount in words as written
 * @param {string} [o.date]        payment date, DD/MM/YYYY
 * @param {'none'|'drawn'|'image'|'annotation'|'typed'} [o.signature]
 * @param {string} [o.details]
 */
export async function makeRequisitionPdf(o) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (str, x, y, size = 10, f = font) => page.drawText(str, { x, y, size, font: f, color: rgb(0, 0, 0) });

  text(o.company, 50, 785, 15, bold);
  text('CHEQUE REQUISITION VOUCHER', 50, 760, 12, bold);
  text('Date of Requisitioning: 03/06/2026', 50, 725);
  text(`Date of Payment: ${o.date ?? '05/06/2026'}`, 330, 725);
  text(`PAYEE: ${o.payee}`, 50, 695);
  text(`CHQ: ${o.chq}`, 330, 695);
  text(`AMOUNT: ${o.amount}`, 440, 695);
  text(`SHILLINGS: ${o.words}`, 50, 665);
  text(`Details: ${o.details ?? 'Payment as per attached invoice'}`, 50, 635);

  text('Prepared by: Jane W.', 50, 200);
  text('Approved by:', 320, 200);
  page.drawLine({ start: { x: 400, y: 198 }, end: { x: 548, y: 198 }, thickness: 0.7, color: rgb(0, 0, 0) });
  // Printed inside the signature area on purpose: it must not count as a signature.
  text('Authorised signatory', 432, 190, 7);

  const signature = o.signature ?? 'none';
  const blue = rgb(0.06, 0.1, 0.5);

  if (signature === 'drawn') {
    page.drawSvgPath('M 0 22 C 12 -12, 22 44, 38 16 S 62 -6, 78 22 S 104 38, 124 6 C 110 30, 90 34, 70 30', {
      x: 408,
      y: 240,
      borderColor: blue,
      borderWidth: 1.3,
    });
  }

  if (signature === 'image') {
    const png = await doc.embedPng(signaturePng());
    page.drawImage(png, { x: 410, y: 202, width: 120, height: 36 });
  }

  if (signature === 'typed') {
    text('Brian', 440, 212, 14);
  }

  if (signature === 'annotation') {
    // A pen ("ink") annotation with its own appearance, as PDF readers save them.
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      pts.push([410 + t * 120, 220 + Math.sin(t * Math.PI * 6) * 14]);
    }
    const stream =
      `0.06 0.1 0.5 RG 1.4 w ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} m ` +
      pts.slice(1).map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)} l`).join(' ') +
      ' S';
    const rect = [405, 202, 535, 238];
    const appearance = doc.context.register(
      doc.context.stream(stream, { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: {} })
    );
    const annotation = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Ink',
        Rect: rect,
        InkList: [pts.flat()],
        C: [0.06, 0.1, 0.5],
        F: 4,
        AP: { N: appearance },
      })
    );
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]));
  }

  return doc.save();
}

/** A PDF with no text at all, like a scan. */
export async function makeImageOnlyPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const png = await doc.embedPng(signaturePng());
  page.drawImage(png, { x: 100, y: 400, width: 300, height: 90 });
  return doc.save();
}
