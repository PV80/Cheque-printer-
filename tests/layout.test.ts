import { describe, expect, it } from 'vitest';
import { buildPrintHtml, chequeValues, DEFAULT_TEMPLATE, layoutCheque, MIN_FONT_PT, pageSizeMm } from '../src/core/layout';
import { fakeMeasure, makeCompany } from './helpers';

const values = chequeValues({ date: '2026-06-05', payee: 'Paul Angalushe', amountCents: 5_800_000 });

describe('chequeValues', () => {
  it('formats what is printed on the cheque', () => {
    expect(values).toEqual({
      date: '05/06/2026',
      payee: 'Paul Angalushe',
      amountFigures: '58,000/=',
      amountWords: 'Fifty Eight Thousand Only',
    });
  });

  it('keeps cents in both figures and words', () => {
    const v = chequeValues({ date: '2026-06-05', payee: 'X', amountCents: 1_500_050 });
    expect(v.amountFigures).toBe('15,000.50');
    expect(v.amountWords).toBe('Fifteen Thousand and Fifty Cents Only');
  });
});

describe('layoutCheque', () => {
  it('places each field where the company layout says', () => {
    const company = makeCompany('A Ltd');
    const layout = layoutCheque(values, company, fakeMeasure);
    const payee = layout.fields.find((f) => f.key === 'payee')!;
    expect(payee.lines).toEqual([{ text: 'Paul Angalushe', xMm: 22, yMm: 34 }]);
    expect(payee.fontPt).toBe(11);
    expect(layout.overflow).toEqual([]);
  });

  it('uses each company\'s own layout and printer offsets', () => {
    const a = makeCompany('A Ltd');
    const b = makeCompany('B Ltd', { printerOffsetX: 1.5, printerOffsetY: -2 });
    b.template = structuredClone(DEFAULT_TEMPLATE);
    b.template.pageTopOffset = 10;
    b.template.fields.payee.x = 30;

    const payeeA = layoutCheque(values, a, fakeMeasure).fields.find((f) => f.key === 'payee')!;
    const payeeB = layoutCheque(values, b, fakeMeasure).fields.find((f) => f.key === 'payee')!;
    expect(payeeA.lines[0]).toMatchObject({ xMm: 22, yMm: 34 });
    expect(payeeB.lines[0]).toMatchObject({ xMm: 31.5, yMm: 42 });
  });

  it('shrinks a long payee to fit instead of cutting it off', () => {
    const company = makeCompany('A Ltd');
    const long = { ...values, payee: 'The Registered Trustees of the Very Long Named Welfare Association of Kenya' };
    const payee = layoutCheque(long, company, fakeMeasure).fields.find((f) => f.key === 'payee')!;
    expect(payee.overflow).toBe(false);
    expect(payee.fontPt).toBeLessThan(11);
    expect(payee.fontPt).toBeGreaterThanOrEqual(MIN_FONT_PT);
    expect(payee.lines[0].text).toBe(long.payee);
    expect(fakeMeasure(long.payee, payee.fontPt, 'Arial', 'normal')).toBeLessThanOrEqual(payee.widthMm);
  });

  it('flags text that cannot fit even at the smallest size', () => {
    const company = makeCompany('A Ltd');
    const impossible = { ...values, payee: 'X'.repeat(400) };
    const layout = layoutCheque(impossible, company, fakeMeasure);
    expect(layout.overflow).toEqual(['payee']);
  });

  it('flags text that would hang over the edge of the cheque', () => {
    const nudged = makeCompany('Z Ltd', { printerOffsetX: 5 });
    expect(layoutCheque(values, nudged, fakeMeasure).overflow).toEqual([]); // the text itself still fits

    const pushedRight = makeCompany('A Ltd', { printerOffsetX: 60 });
    expect(layoutCheque(values, pushedRight, fakeMeasure).overflow).toEqual(['date', 'amountFigures']);

    const pushedLeft = makeCompany('B Ltd', { printerOffsetX: -30 });
    expect(layoutCheque(values, pushedLeft, fakeMeasure).overflow).toContain('payee');

    const tooLow = makeCompany('C Ltd');
    tooLow.template.fields.amountWords.y = 84;
    expect(layoutCheque(values, tooLow, fakeMeasure).overflow).toEqual(['amountWords']);
  });

  it('wraps amount words on to the second ruled line', () => {
    const company = makeCompany('A Ltd');
    const v = chequeValues({ date: '2026-06-05', payee: 'X', amountCents: 123_456_789_012 });
    const words = layoutCheque(v, company, fakeMeasure).fields.find((f) => f.key === 'amountWords')!;
    expect(words.overflow).toBe(false);
    expect(words.lines.length).toBe(2);
    expect(words.lines[0].yMm).toBe(46);
    expect(words.lines[1].yMm).toBeCloseTo(46 + 8.5, 5);
    expect(words.lines.map((l) => l.text).join(' ')).toBe(v.amountWords);
  });

  it('never uses more lines than the cheque has room for', () => {
    const company = makeCompany('A Ltd');
    company.template.fields.amountWords.width = 40;
    const v = chequeValues({ date: '2026-06-05', payee: 'X', amountCents: 123_456_789_012 });
    const layout = layoutCheque(v, company, fakeMeasure);
    const words = layout.fields.find((f) => f.key === 'amountWords')!;
    expect(layout.overflow).toContain('amountWords');
    expect(words.overflow).toBe(true);
  });
});

describe('buildPrintHtml', () => {
  const company = makeCompany('A Ltd');
  const layout = layoutCheque(values, company, fakeMeasure);

  it('sets the page to the exact cheque size with no margin', () => {
    const html = buildPrintHtml([layout], company.template, { title: 'Test' });
    expect(pageSizeMm(company.template)).toEqual({ widthMm: 215, heightMm: 85 });
    expect(html).toContain('@page{size:215mm 85mm;margin:0}');
  });

  it('prints one page per cheque', () => {
    const html = buildPrintHtml([layout, layout, layout], company.template, { title: 'Test' });
    expect(html.match(/class="page"/g)).toHaveLength(3);
  });

  it('includes the page top offset in the sheet height', () => {
    const tall = makeCompany('Tall Ltd');
    tall.template.pageTopOffset = 20;
    const html = buildPrintHtml([layoutCheque(values, tall, fakeMeasure)], tall.template, { title: 'T' });
    expect(html).toContain('@page{size:215mm 105mm;margin:0}');
    expect(html).toContain('top:54mm');
  });

  it('escapes anything that came from a PDF', () => {
    const nasty = layoutCheque({ ...values, payee: '<script>alert(1)</script> & "Sons"' }, company, fakeMeasure);
    const html = buildPrintHtml([nasty], company.template, { title: '<b>x</b>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Sons&quot;');
    expect(html).toContain('<title>&lt;b&gt;x&lt;/b&gt;</title>');
  });
});
