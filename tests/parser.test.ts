import { describe, expect, it } from 'vitest';
import { findNameConflict, matchCompany, normaliseCompanyName } from '../src/core/company';
import { buildLines, parseRequisition, type TextItem } from '../src/core/parser';
import { makeCompany } from './helpers';

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
    expect(parseRequisition([VOUCHER])).toEqual({
      documentType: 'requisition_voucher',
      companyRaw: 'GOLDEN IVY INVESTMENTS LTD',
      payee: 'Paul Angalushe',
      dateRaw: '05/06/2026',
      date: '2026-06-05',
      amountCents: 5_800_000,
      amountWordsRaw: 'Fifty Eight Thousand Only',
      wordsCents: 5_800_000,
      chequeNumber: '000123',
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
    expect(parseRequisition([VOUCHER]).date).toBe('2026-06-05');
    const lines = VOUCHER.filter((l) => !l.includes('Date of Payment'));
    lines.splice(2, 0, 'Date of Requisitioning: 03/06/2026');
    expect(parseRequisition([lines]).date).toBe('2026-06-03');
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

describe('parseRequisition — ERP payment receipt', () => {
  const RECEIPT = [
    'Payment Receipt',
    'Bank: NCBA Bank - Golden Ivy Investments Ltd',
    'Vendor: Acme Supplies Ltd',
    'Payment Date: 05/06/2026',
    'Payment Amount: KSh 58,000.00',
    'Memo: Cheque number 000125 for invoice 77',
  ];

  it('reads the receipt layout', () => {
    const parsed = parseRequisition([RECEIPT]);
    expect(parsed.documentType).toBe('payment_receipt');
    expect(parsed.companyRaw).toBe('Golden Ivy Investments Ltd');
    expect(parsed.payee).toBe('Acme Supplies Ltd');
    expect(parsed.date).toBe('2026-06-05');
    expect(parsed.amountCents).toBe(5_800_000);
    expect(parsed.chequeNumber).toBe('000125');
    expect(parsed.wordsCents).toBeNull();
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
