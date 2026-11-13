import { describe, expect, it } from 'vitest';
import { chequeNumberAfter, formTypeOf, parsePayroll } from '../src/core/payroll';

const header = ['Sample Company Ltd', 'Office 1, Sample Plaza,', 'Nairobi Kenya'];

/** The two pages of one salary slip, as lines of text. */
function slip(name: string, net: string, options: { toPayName?: string; toPayAmount?: string } = {}): string[][] {
  return [
    [...header, `Salary Slip - ${name} - October 2026`, 'Employee   Pay Period', `${name}   10/01/2026 - 10/31/2026`, 'Basic Salary (Monthly)   KSh 99,999.00', 'Page 1 / 2'],
    [
      ...header,
      'NAME   NUMBER OF HOURS   NUMBER OF DAYS   AMOUNT',
      'Total Deductions   KSh 35,768.35',
      'Salary advance   KSh -10,000.00',
      `Net Salary   KSh ${net}`,
      `To pay on xxxxxxxxxxxx of ${options.toPayName ?? name} : KSh ${options.toPayAmount ?? net}`,
      'Employee signature:__________________________________',
      "Director's signature: _________________________________",
      'Page 2 / 2',
    ],
  ];
}

describe('parsePayroll', () => {
  it('finds one salary slip per employee, with the pages each covers', () => {
    const pages = [...slip('JANE SAMPLE', '82,045.15'), ...slip('JOHN EXAMPLE', '41,017.90')];
    expect(parsePayroll(pages)).toEqual([
      { pages: { from: 1, to: 2 }, companyRaw: 'Sample Company Ltd', payee: 'JANE SAMPLE', period: 'October 2026', amountCents: 8_204_515, chequeNumber: '', reviewNotes: [] },
      { pages: { from: 3, to: 4 }, companyRaw: 'Sample Company Ltd', payee: 'JOHN EXAMPLE', period: 'October 2026', amountCents: 4_101_790, chequeNumber: '', reviewNotes: [] },
    ]);
  });

  it('keeps the pages of a long slip together', () => {
    const long = slip('LONG SLIP', '31,948.92');
    long.push([...header, 'Sample Director', "Director's signature: _________________________________", 'Page 3 / 3']);
    const slips = parsePayroll([...slip('FIRST PERSON', '1,000.00'), ...long, ...slip('LAST PERSON', '2,000.00')]);
    expect(slips.map((s) => [s.payee, s.pages.from, s.pages.to])).toEqual([
      ['FIRST PERSON', 1, 2],
      ['LONG SLIP', 3, 5],
      ['LAST PERSON', 6, 7],
    ]);
  });

  it('reads the net pay when the figures are spread across columns', () => {
    const pages = slip('SPREAD OUT', '31,948.92');
    pages[1] = pages[1].map((line) => line.replace('Net Salary   KSh 31,948.92', 'Net Salary   KSh   31,948.92').replace(': KSh 31,948.92', ':   KSh   31,948.92'));
    expect(parsePayroll(pages)[0].amountCents).toBe(3_194_892);
  });

  it('pays the net salary, never another figure on the slip', () => {
    const [only] = parsePayroll(slip('DEDUCTED', '26,208.85'));
    expect(only.amountCents).toBe(2_620_885); // not the basic salary, the deductions or the advance
  });

  it('raises a doubt when the slip disagrees with itself', () => {
    expect(parsePayroll(slip('RIGHT NAME', '5,000.00', { toPayName: 'OTHER NAME' }))[0].reviewNotes).toEqual(['The slip is titled for RIGHT NAME but says to pay OTHER NAME.']);
    expect(parsePayroll(slip('SAME NAME', '5,000.00', { toPayAmount: '6,000.00' }))[0].reviewNotes).toEqual(['The net salary (5,000.00) and the amount to pay (6,000.00) differ.']);
  });

  it('shows nothing to pay for a slip with no net pay', () => {
    expect(parsePayroll(slip('ZERO PAY', '0.00'))[0].amountCents).toBe(0);
    const noNet = slip('NO FIGURE', '1.00').map((page) => page.filter((line) => !/net salary|to pay/i.test(line)));
    expect(parsePayroll(noNet)[0].amountCents).toBe(0);
  });

  it('uses a cheque number only if the slip itself names one', () => {
    const pages = slip('NUMBERED', '5,000.00');
    pages[1].push('Cheque No: 000671');
    expect(parsePayroll(pages)[0].chequeNumber).toBe('000671');
  });

  it('takes names with hyphens, and other spellings of the title', () => {
    expect(parsePayroll([[...header, 'Salary Slip - ANNE-MARIE O-KEEFE - March 2027']])[0]).toMatchObject({ payee: 'ANNE-MARIE O-KEEFE', period: 'March 2027' });
    expect(parsePayroll([[...header, 'Payslip – JOHN EXAMPLE – Feb 2027']])[0]).toMatchObject({ payee: 'JOHN EXAMPLE', period: 'Feb 2027' });
  });

  it('is empty for anything that is not a payroll', () => {
    expect(parsePayroll([['Sample Company Ltd', 'CHEQUE REQUISITION VOUCHER', 'PAYEE: Somebody', 'Salary for October']])).toEqual([]);
    expect(parsePayroll([])).toEqual([]);
  });
});

describe('formTypeOf', () => {
  it('tells a payroll from the other forms', () => {
    expect(formTypeOf(slip('JANE SAMPLE', '1,000.00'))).toBe('salary_slip');
    expect(formTypeOf([['Sample Company Ltd', 'CHEQUE REQUISITION VOUCHER']])).toBe('requisition_voucher');
    expect(formTypeOf([['Something else entirely']])).toBe('unknown');
  });
});

describe('chequeNumberAfter', () => {
  it('counts up from the first leaf, keeping leading zeros', () => {
    expect([0, 1, 2].map((n) => chequeNumberAfter('000672', n))).toEqual(['000672', '000673', '000674']);
    expect(chequeNumberAfter('000999', 1)).toBe('001000');
    expect(chequeNumberAfter('99', 1)).toBe('100');
  });

  it('gives nothing until a number has been typed', () => {
    expect(chequeNumberAfter('', 3)).toBe('');
    expect(chequeNumberAfter('67a', 1)).toBe('');
    expect(chequeNumberAfter('999999999999', 1)).toBe('');
  });
});
