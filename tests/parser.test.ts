import { describe, expect, it } from 'vitest';
import { findNameConflict, matchCompany, normaliseCompanyName } from '../src/core/company';
import { buildLines, parseRequisition, type TextItem } from '../src/core/parser';
import { makeCompany } from './helpers';

// The day the sample documents were produced; settles day/month order in their dates.
const MADE = { producedOn: '2026-06-04' };

const VOUCHER = [
  'GOLDEN IVY INVESTMENTS LTD',
  'CHEQUE REQUISITION VOUCHER',
  'Date of Requisitioning: 03/06/2026   Date of Payment: 05/06/2026',
  'PAYEE: Paul Angalushe CHQ: 000123 AMOUNT: 58,000/=',
  'SHILLINGS: Fifty Eight Thousand Only',
  'Details: Site labour for June',
  'Prepared by: Jane   Approved by: Brian',
];

describe('buildLines', () => {
  const item = (str: string, x: number, y: number, width = str.length * 5): TextItem => ({ str, x, y, width, height: 10 });

  it('rebuilds lines top to bottom and marks wide gaps as columns', () => {
    const lines = buildLines([
      item('AMOUNT: 58,000/=', 300, 100.4),
      item('PAYEE:', 20, 100),
      item('Paul Angalushe', 55, 100.2),
      item('GOLDEN IVY INVESTMENTS LTD', 20, 40),
      item('', 0, 60),
    ]);
    expect(lines).toEqual(['GOLDEN IVY INVESTMENTS LTD', 'PAYEE: Paul Angalushe   AMOUNT: 58,000/=']);
  });

  it('joins fragments of one word without adding spaces', () => {
    const lines = buildLines([item('Angal', 20, 50, 25), item('ushe', 45, 50, 20)]);
    expect(lines).toEqual(['Angalushe']);
  });
});

describe('parseRequisition — requisition voucher', () => {
  it('reads every field from a standard voucher', () => {
    expect(parseRequisition([VOUCHER], MADE)).toEqual({
      documentType: 'requisition_voucher',
      companyRaw: 'GOLDEN IVY INVESTMENTS LTD',
      payee: 'Paul Angalushe',
      dateRaw: '05/06/2026',
      date: '2026-06-05',
      amountCents: 5_800_000,
      amountWordsRaw: 'Fifty Eight Thousand Only',
      wordsCents: 5_800_000,
      chequeNumber: '000123',
      reviewNotes: [],
      otherRequisitionPages: [],
    });
  });

  it('works when the form has no colons', () => {
    const lines = [...VOUCHER];
    lines[3] = 'PAYEE Paul Angalushe CHQ 000123 AMOUNT 58,000/=';
    const parsed = parseRequisition([lines]);
    expect(parsed.payee).toBe('Paul Angalushe');
    expect(parsed.chequeNumber).toBe('000123');
    expect(parsed.amountCents).toBe(5_800_000);
  });

  it('does not cut a payee whose name contains label words', () => {
    const lines = [...VOUCHER];
    lines[3] = 'PAYEE: Date Palm Bank & Amount Supplies Ltd CHQ: 000124 AMOUNT: 1,250.50';
    const parsed = parseRequisition([lines]);
    expect(parsed.payee).toBe('Date Palm Bank & Amount Supplies Ltd');
    expect(parsed.chequeNumber).toBe('000124');
    expect(parsed.amountCents).toBe(125_050);
  });

  it('prefers the payment date over the requisition date', () => {
    expect(parseRequisition([VOUCHER], MADE).date).toBe('2026-06-05');
    const lines = VOUCHER.filter((l) => !l.includes('Date of Payment'));
    lines.splice(2, 0, 'Date of Requisitioning: 03/06/2026');
    expect(parseRequisition([lines], MADE).date).toBe('2026-06-03');
  });

  it('reports what the words say even when they disagree with the figures', () => {
    const lines = [...VOUCHER];
    lines[4] = 'SHILLINGS: Fifty Thousand Only';
    const parsed = parseRequisition([lines]);
    expect(parsed.amountCents).toBe(5_800_000);
    expect(parsed.wordsCents).toBe(5_000_000);
  });

  it('follows amount words on to a second line', () => {
    const lines = [...VOUCHER];
    lines.splice(4, 1, 'SHILLINGS: One Million Two Hundred Thirty Four Thousand', 'Five Hundred Sixty Seven Only');
    lines[3] = 'PAYEE: Paul Angalushe CHQ: 000123 AMOUNT: 1,234,567/=';
    const parsed = parseRequisition([lines]);
    expect(parsed.wordsCents).toBe(123_456_700);
    expect(parsed.amountCents).toBe(123_456_700);
  });

  it('leaves fields empty rather than guessing', () => {
    const parsed = parseRequisition([['Some unrelated letter', 'Dear Sir, please find attached.']]);
    expect(parsed.payee).toBe('');
    expect(parsed.chequeNumber).toBe('');
    expect(parsed.amountCents).toBe(0);
    expect(parsed.date).toBe('');
    expect(parsed.wordsCents).toBeNull();
  });

  it('does not mistake the voucher title for a cheque number label', () => {
    const lines = ['ACME HOLDINGS LIMITED', 'CHEQUE REQUISITION VOUCHER 2026', 'PAYEE: John Doe', 'CHQ NO: 004455', 'AMOUNT: 2,000/='];
    const parsed = parseRequisition([lines]);
    expect(parsed.chequeNumber).toBe('004455');
    expect(parsed.companyRaw).toBe('ACME HOLDINGS LIMITED');
  });

  it('takes the company from the header, not from the payee line', () => {
    const lines = [...VOUCHER];
    lines[3] = 'PAYEE: Golden Ivy Properties Ltd CHQ: 000123 AMOUNT: 58,000/=';
    expect(parseRequisition([lines]).companyRaw).toBe('GOLDEN IVY INVESTMENTS LTD');
  });
});

// The two forms actually in use, with made-up names and amounts.
const REAL_VOUCHER = [
  'SAMPLE ESTATE AGENTS',
  'CHEQUE REQUISITION VOUCHER',
  'Date of Requisitioning: 10/11/2026',
  'Date of Payment: 10/11/2026',
  'PAYE: Jane Wanjiku Doe   CHQ 000601   AMOUNT: 25,108/=',
  'SHILLING: Twenty Five Thousand One Hundred Eight Only ________________________________',
  'Commission for Unit 7B',
  'Contract',
  'Amount_______________   Already paid ________________   Balance___________',
  'Account Description   Account No   Tran. code',
  'COMMISSION   25,000/=',
  'FINANCIAL EXPENSES   108/=',
  '25,108/=',
  'Prepared By:   Authorized By:   Cheque collected By: __________________________',
  'Jane Doe   John Approver   Amount _______________ ID No.__________________',
  'Sign: ____________________ Date: ________________',
  'Date: 10/11/2026   Date: 10/11/2026',
];

const receipt = (date: string, bank: string, reference: [string, string], amount = 'KSh 59,000.00') => [
  'Golden Ivy Investments',
  'Office 13, Sample Plaza,',
  'Nairobi Kenya',
  'Payment Receipt: PBNK9/2026/00001',
  `Payment Date: ${date}   Payment Amount: ${amount}`,
  'Vendor: JOHN SAMPLE PAYEE   Payment Method: Checks',
  `Bank: ${bank}`,
  'INVOICE',
  'INVOICE NUMBER   REFERENCE   AMOUNT',
  'DATE',
  `${date}   BILL/2026/11/0001   ${reference[0]}`,
  reference[1],
  `${date}   PBNK9/2026/00001   ${reference[0].replace('KSh ', 'KSh -')}`,
  reference[1],
  'Due Amount for   KSh 0.00',
  'BILL/2026/11/0001',
  'PREPARED BY: __________________________________________',
  'APPROVED BY: __________________________________________John Approver',
  '+254 700 000000 info@example.com P000000000X   Page 1 / 1',
];

describe('parseRequisition — the typed voucher as really used', () => {
  it('reads PAYE:, SHILLING: and a cheque number with no "No."', () => {
    expect(parseRequisition([REAL_VOUCHER], { producedOn: '2026-11-10' })).toEqual({
      documentType: 'requisition_voucher',
      companyRaw: 'SAMPLE ESTATE AGENTS',
      payee: 'Jane Wanjiku Doe',
      dateRaw: '10/11/2026',
      date: '2026-11-10',
      amountCents: 2_510_800,
      amountWordsRaw: 'Twenty Five Thousand One Hundred Eight Only',
      wordsCents: 2_510_800,
      chequeNumber: '000601',
      reviewNotes: [],
      otherRequisitionPages: [],
    });
  });

  it('ignores the amounts in the breakdown table and the blank "Amount ____" boxes', () => {
    expect(parseRequisition([REAL_VOUCHER], { producedOn: '2026-11-10' }).amountCents).toBe(2_510_800);
  });

  it('never fills a gap on page one from a supporting page', () => {
    const page1 = REAL_VOUCHER.map((l) => (l.startsWith('PAYE:') ? 'CHQ 000601   AMOUNT: 25,108/=' : l));
    const page2 = ['REQUISITION NOTE', 'PAYEE: Somebody On Another Page', 'AMOUNT: 99,999/='];
    const parsed = parseRequisition([page1, page2], { producedOn: '2026-11-10' });
    expect(parsed.payee).toBe('');
    expect(parsed.amountCents).toBe(2_510_800);
  });

  it('reports a second requisition hiding in the same PDF', () => {
    expect(parseRequisition([REAL_VOUCHER, REAL_VOUCHER, ['Invoice']]).otherRequisitionPages).toEqual([2]);
    expect(parseRequisition([REAL_VOUCHER, ['REQUISITION NOTE', 'PAYEE: X']]).otherRequisitionPages).toEqual([]);
  });
});

describe('parseRequisition — the accounts-system payment receipt as really used', () => {
  const NOV = { producedOn: '2026-11-10' };

  it('reads a receipt whose cheque number wrapped on to the next line', () => {
    const lines = receipt('10/11/2026', 'NCBA Bank -Sample Estate', ['Withdrawal for November 2026 - Cheque No.   KSh 59,000.00', '600']);
    expect(parseRequisition([lines], NOV)).toEqual({
      documentType: 'payment_receipt',
      companyRaw: 'NCBA Bank -Sample Estate (Golden Ivy Investments)',
      payee: 'JOHN SAMPLE PAYEE',
      dateRaw: '10/11/2026',
      date: '2026-11-10',
      amountCents: 5_900_000,
      amountWordsRaw: '',
      wordsCents: null,
      chequeNumber: '600',
      reviewNotes: [],
      otherRequisitionPages: [],
    });
  });

  it('reads a cheque number split as "Cheque" / "No. 582"', () => {
    const lines = receipt('10/11/2026', 'I&M Bank', ['Withdrawal for the month of November 2026 - Cheque KSh 59,000.00', 'No. 582']);
    const parsed = parseRequisition([lines], NOV);
    expect(parsed.chequeNumber).toBe('582');
    expect(parsed.companyRaw).toBe('I&M Bank (Golden Ivy Investments)');
  });

  it('reads a cheque number that fits on one line', () => {
    const lines = receipt('10/11/2026', 'I&M Bank', ['Payment of water bill for   KSh 59,000.00', 'October 2026 - Cheque No. 585']);
    expect(parseRequisition([lines], NOV).chequeNumber).toBe('585');
  });

  it('does not take a stray number after the word cheque as the cheque number', () => {
    const lines = receipt('10/11/2026', 'I&M Bank', ['Refund paid by cheque   KSh 59,000.00', '600 units returned']);
    expect(parseRequisition([lines], NOV).chequeNumber).toBe('');
  });

  it('holds back when two different cheque numbers are mentioned', () => {
    const lines = receipt('10/11/2026', 'I&M Bank', ['Rent - Cheque No. 585   KSh 59,000.00', 'replaces Cheque No. 580']);
    const parsed = parseRequisition([lines], NOV);
    expect(parsed.chequeNumber).toBe('');
    expect(parsed.reviewNotes.join(' ')).toContain('More than one cheque number');
  });

  it('accepts a month-first date when that is the only possible reading', () => {
    const lines = receipt('10/13/2026', 'I&M Bank', ['Bill - Cheque No. 585   KSh 59,000.00', '']);
    expect(parseRequisition([lines], { producedOn: '2026-10-13' }).date).toBe('2026-10-13');
    expect(parseRequisition([lines]).date).toBe('2026-10-13');
  });

  it('settles day/month order from when the document was produced', () => {
    const lines = receipt('10/07/2026', 'I&M Bank', ['Bill - Cheque No. 589   KSh 59,000.00', '']);
    expect(parseRequisition([lines], { producedOn: '2026-10-07' }).date).toBe('2026-10-07'); // month first
    expect(parseRequisition([lines], { producedOn: '2026-07-10' }).date).toBe('2026-07-10'); // day first
  });

  it('holds back when the date could be read two ways', () => {
    const lines = receipt('10/11/2026', 'I&M Bank', ['Bill - Cheque No. 589   KSh 59,000.00', '']);
    for (const options of [undefined, { producedOn: '2026-10-26' }, { producedOn: '2027-03-01' }]) {
      const parsed = parseRequisition([lines], options);
      expect(parsed.date).toBe('');
      expect(parsed.reviewNotes).toEqual(['The date 10/11/2026 could be 10 November 2026 or 11 October 2026. Enter the right one.']);
    }
  });

  it('refuses an amount it cannot read exactly instead of taking the first digits', () => {
    for (const amount of ['KSh 58 000.00', 'KES 58.000,00', 'KSh 58, 000.00', 'KSh 58,000.00 approx']) {
      const parsed = parseRequisition([receipt('10/13/2026', 'I&M Bank', ['Bill - Cheque No. 585   KSh 1.00', ''], amount)]);
      expect(parsed.amountCents, amount).toBe(0);
      expect(parsed.reviewNotes.join(' '), amount).toContain('could not be read for certain');
    }
  });
});

describe('parseRequisition — doubts are raised, not guessed', () => {
  it('holds back when two labelled amounts disagree', () => {
    const lines = ['ACME HOLDINGS LIMITED', 'CHEQUE REQUISITION VOUCHER', 'PAYEE: John Doe   CHQ 000700', 'Invoice Amount: 60,000/=', 'Net Amount: 58,000/='];
    const parsed = parseRequisition([lines]);
    expect(parsed.amountCents).toBe(0);
    expect(parsed.reviewNotes.join(' ')).toContain('More than one amount');
  });

  it('prefers "Payment Amount" over other amount labels', () => {
    const lines = ['Payment Receipt: X/1', 'Payment Amount: KSh 58,000.00', 'Total Amount: KSh 60,000.00', 'Vendor: John Doe', 'Bank: Test Bank'];
    expect(parseRequisition([lines]).amountCents).toBe(5_800_000);
  });

  it('flags a payee that may continue on the next line', () => {
    const lines = ['ACME HOLDINGS LIMITED', 'CHEQUE REQUISITION VOUCHER', 'PAYEE: The Registered Trustees of the', 'Sample Welfare Association', 'CHQ 000700   AMOUNT: 2,000/='];
    const parsed = parseRequisition([lines]);
    expect(parsed.payee).toBe('The Registered Trustees of the');
    expect(parsed.reviewNotes.join(' ')).toContain('payee may run on');
  });

  it('reads a year-first date with slashes as written', () => {
    const lines = ['ACME HOLDINGS LIMITED', 'CHEQUE REQUISITION VOUCHER', 'Date of Payment: 2026/06/25', 'PAYEE: John Doe   CHQ 000700   AMOUNT: 2,000/='];
    expect(parseRequisition([lines]).date).toBe('2026-06-25');
  });
});

describe('company matching', () => {
  const investments = makeCompany('Golden Ivy Investments Ltd');
  const properties = makeCompany('Golden Ivy Properties Ltd', { aliases: ['GIP Limited'] });
  const companies = [investments, properties];

  it('ignores case, punctuation and Ltd/Limited', () => {
    expect(normaliseCompanyName('GOLDEN IVY INVESTMENTS LIMITED.')).toBe(normaliseCompanyName('Golden Ivy Investments Ltd'));
    expect(matchCompany('GOLDEN IVY INVESTMENTS LIMITED', companies)).toBe(investments);
    expect(matchCompany('gip ltd', companies)).toBe(properties);
  });

  it('never matches on part of a name', () => {
    expect(matchCompany('Golden Ivy', companies)).toBeNull();
    expect(matchCompany('Golden Ivy Investments Ltd Nairobi', companies)).toBeNull();
    expect(matchCompany('', companies)).toBeNull();
  });

  it('keeps sister companies apart', () => {
    expect(matchCompany('Golden Ivy Properties Ltd', companies)).toBe(properties);
    expect(matchCompany('Golden Ivy Investments Ltd', companies)).toBe(investments);
  });

  it('spots a name already owned by another company', () => {
    const clash = makeCompany('Something Else', { aliases: ['Golden Ivy Properties Limited'] });
    expect(findNameConflict(clash, companies)?.other).toBe(properties);
    expect(findNameConflict(investments, companies)).toBeNull();
  });
});
