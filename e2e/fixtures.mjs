// Builds sample requisition PDFs for the end-to-end test. All names and
// amounts are made up. The signature can be added the ways people really
// sign on screen: drawn strokes, a pasted image, or a pen annotation.

import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, rgb, StandardFonts } from 'pdf-lib';

export const PAGE = { w: 595, h: 842 }; // A4 in points

// Every sample says it was produced on 5 June 2026. The app uses that day to
// tell whether 05/06/2026 is day-first or month-first.
const PRODUCED = new Date(Date.UTC(2026, 5, 5, 9, 0, 0));
function stamp(doc) {
  doc.setCreationDate(PRODUCED);
  doc.setModificationDate(PRODUCED);
}

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

  if (o.note) {
    // Page two: the requisition note. Some vouchers are signed here instead of on page one.
    const second = doc.addPage([PAGE.w, PAGE.h]);
    const line = (str, x, y, size = 10, f = font) => second.drawText(str, { x, y, size, font: f, color: rgb(0, 0, 0) });
    line(o.company, 50, 785, 15, bold);
    line('REQUISITION NOTE', 50, 760, 12, bold);
    line(`DETAIL: ${o.details ?? 'Payment as per attached invoice'}`, 50, 700);
    line('REQUESTED BY:', 50, 600);
    line('APPROVED BY:', 320, 600);
    line('Jane W.', 50, 560);
    line('John Approver', 320, 560);
    if (o.note === 'signed') {
      second.drawSvgPath('M 0 22 C 12 -12, 22 44, 38 16 S 62 -6, 78 22 S 104 38, 124 6 C 110 30, 90 34, 70 30', {
        x: 410,
        y: 612,
        borderColor: blue,
        borderWidth: 1.3,
      });
    }
  }

  stamp(doc);
  return doc.save();
}

/** Where the approver signs on page two of the voucher (the requisition note). */
export const NOTE_SIGNATURE_BOX = {
  x: 400 / PAGE.w,
  y: (PAGE.h - 562 - 64) / PAGE.h,
  w: 160 / PAGE.w,
  h: 64 / PAGE.h,
};

// ---- The accounts-system payment receipt (US letter) -------------------------------

const LETTER = { w: 612, h: 792 };
const RECEIPT_SIGN_AREA = { x: 104, y: 254, w: 232, h: 38 };

/** Where the approver signs on the receipt, as page fractions from the top-left. */
export const RECEIPT_SIGNATURE_BOX = {
  x: RECEIPT_SIGN_AREA.x / LETTER.w,
  y: (LETTER.h - RECEIPT_SIGN_AREA.y - RECEIPT_SIGN_AREA.h) / LETTER.h,
  w: RECEIPT_SIGN_AREA.w / LETTER.w,
  h: RECEIPT_SIGN_AREA.h / LETTER.h,
};

/**
 * @param {object} o
 * @param {string} o.bank      the bank account line, e.g. "I&M Bank"
 * @param {string} o.payee
 * @param {string} o.date      as the accounts system prints it (it has used both MM/DD and DD/MM)
 * @param {string} o.amount    e.g. "59,000.00"
 * @param {string} o.chq       cheque number; printed on its own line, as when the reference wraps
 * @param {boolean} [o.signed]
 * @param {boolean} [o.approvalOnPage2]  a long receipt: the approval lines fall on a second page
 */
export async function makeReceiptPdf(o) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([LETTER.w, LETTER.h]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (str, x, y, size = 9, f = font, color = rgb(0, 0, 0)) => page.drawText(str, { x, y, size, font: f, color });

  text('Golden Ivy Investments', 380, 740);
  text('Office 13, Sample Plaza,', 380, 727);
  text('Nairobi Kenya', 380, 714);
  text('Payment Receipt: PBNK9/2026/00002', 40, 640, 15, bold);
  text(`Payment Date: ${o.date}`, 40, 612);
  text(`Payment Amount: KSh ${o.amount}`, 320, 612);
  text(`Vendor: ${o.payee}`, 40, 582);
  text('Payment Method: Checks', 320, 582);
  text(`Bank: ${o.bank}`, 320, 552);

  text('INVOICE', 40, 500, 8, bold);
  text('DATE', 40, 490, 8, bold);
  text('INVOICE NUMBER', 115, 500, 8, bold);
  text('REFERENCE', 290, 500, 8, bold);
  text('AMOUNT', 540, 500, 8, bold);
  text(o.date, 40, 462);
  text('BILL/2026/06/0020', 115, 462);
  text('Withdrawal for June 2026 - Cheque No.', 290, 462);
  text(o.chq, 290, 450); // the number wrapped on to the next line of the cell
  text(`KSh ${o.amount}`, 520, 462);
  text('Due Amount for', 115, 425, 9, bold);
  text('KSh 0.00', 540, 425, 9, bold);

  // The approval lines: normally low on page one; on a long receipt they fall on page two, higher up.
  const sheet = o.approvalOnPage2 ? doc.addPage([LETTER.w, LETTER.h]) : page;
  const top = o.approvalOnPage2 ? 650 : 300;
  const put = (str, x, y, f = bold, color = rgb(0, 0, 0)) => sheet.drawText(str, { x, y, size: 9, font: f, color });
  put('PREPARED BY: ________________________________________', 40, top);
  put('APPROVED BY: ________________________________________', 40, top - 32);
  put('John Approver', 112, top - 29, font, rgb(0.1, 0.3, 0.8)); // typed beside the signature
  if (o.signed) {
    const png = await doc.embedPng(signaturePng());
    sheet.drawImage(png, { x: 205, y: top - 43, width: 105, height: 31 });
  }
  text('+254 700 000000 info@example.com', 40, 60, 8);

  stamp(doc);
  return doc.save();
}

/** A PDF with no text at all, like a scan. */
export async function makeImageOnlyPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const png = await doc.embedPng(signaturePng());
  page.drawImage(png, { x: 100, y: 400, width: 300, height: 90 });
  stamp(doc);
  return doc.save();
}
