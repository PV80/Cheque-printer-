import { describe, expect, it } from 'vitest';
import { amountToWords, formatFigures, formatMoney, parseAmountToCents, wordsToCents } from '../src/core/amount';
import { dateWarning, findDateInText, formatDate, formatTimestamp, formatTimestampDate, isValidIsoDate, parseDate } from '../src/core/dates';

describe('amountToWords', () => {
  it.each([
    [5_800_000, 'Fifty Eight Thousand Only'],
    [1_500_050, 'Fifteen Thousand and Fifty Cents Only'],
    [50, 'Fifty Cents Only'],
    [1, 'One Cent Only'],
    [0, 'Zero Only'],
    [100, 'One Only'],
    [101, 'One and One Cent Only'],
    [1_900, 'Nineteen Only'],
    [10_000_000, 'One Hundred Thousand Only'],
    [100_000_100, 'One Million One Only'],
    [
      123_456_789_012,
      'One Billion Two Hundred Thirty Four Million Five Hundred Sixty Seven Thousand Eight Hundred Ninety and Twelve Cents Only',
    ],
  ])('%i cents', (cents, words) => {
    expect(amountToWords(cents)).toBe(words);
  });

  it('never rounds cents away', () => {
    expect(amountToWords(1_500_050)).toContain('Fifty Cents');
    expect(amountToWords(1_500_099)).toContain('Ninety Nine Cents');
  });

  it('refuses amounts it cannot write exactly', () => {
    expect(() => amountToWords(-1)).toThrow();
    expect(() => amountToWords(10.5)).toThrow();
    expect(() => amountToWords(Number.NaN)).toThrow();
  });
});

describe('formatting figures', () => {
  it('writes whole amounts with /= and keeps cents when present', () => {
    expect(formatFigures(5_800_000)).toBe('58,000/=');
    expect(formatFigures(1_500_050)).toBe('15,000.50');
    expect(formatFigures(1_500_005)).toBe('15,000.05');
    expect(formatFigures(99_900)).toBe('999/=');
    expect(formatFigures(100_000_000)).toBe('1,000,000/=');
  });

  it('formats money for lists', () => {
    expect(formatMoney(5_800_000)).toBe('58,000.00');
    expect(formatMoney(123_456_789)).toBe('1,234,567.89');
  });
});

describe('parseAmountToCents', () => {
  it.each([
    ['15,000/=', 1_500_000],
    ['15,000/-', 1_500_000],
    ['15,000/50', 1_500_050],
    ['KSh 58,000.00', 5_800_000],
    ['Kshs. 58,000', 5_800_000],
    ['KES58,000', 5_800_000],
    ['15000', 1_500_000],
    ['58,000.5', 5_800_050],
    ['1,234,567.89', 123_456_789],
    ['15,000=', 1_500_000],
    [' 250/= ', 25_000],
    ['58,000.00/=', 5_800_000],
    ['58,000.50/=', 5_800_050],
    ['7,000/', 700_000],
  ])('%s', (text, cents) => {
    expect(parseAmountToCents(text)).toBe(cents);
  });

  it.each(['', 'abc', '15,00', '1,5000', '15.000,00', '-500', '12/34/56', '15,000.123'])('rejects %j', (text) => {
    expect(parseAmountToCents(text)).toBeNull();
  });
});

describe('wordsToCents', () => {
  it.each([
    ['Fifty eight thousand only', 5_800_000],
    ['KENYA SHILLINGS FIFTEEN THOUSAND ONLY', 1_500_000],
    ['Fifteen Thousand Shillings and Fifty Cents Only', 1_500_050],
    ['Fifteen thousand and fifty cents only', 1_500_050],
    ['Fifteen thousand cents fifty only', 1_500_050],
    ['Fifteen thousand fifty cents', 1_500_050],
    ['One hundred and five thousand', 10_500_000],
    ['Twenty-five thousand', 2_500_000],
    ['fourty thousand only', 4_000_000],
    ['One Million Two Hundred Thousand Only', 120_000_000],
    ['Fifty Cents Only', 50],
  ])('%s', (text, cents) => {
    expect(wordsToCents(text)).toBe(cents);
  });

  it.each(['', 'Fifteen thousand banana', '15,000', 'only'])('cannot read %j', (text) => {
    expect(wordsToCents(text)).toBeNull();
  });

  it('reads back everything amountToWords writes', () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const samples = [1, 99, 100, 101, 999, 100_000, 100_099, 99_999_999_999];
    for (let i = 0; i < 3000; i++) samples.push(Math.floor(random() * 10 ** (1 + Math.floor(random() * 11))) + 1);
    for (const cents of samples) {
      expect(wordsToCents(amountToWords(cents)), `${cents}`).toBe(cents);
    }
  });
});

describe('dates', () => {
  it.each([
    ['05/06/2026', '2026-06-05'],
    ['5-6-26', '2026-06-05'],
    ['05.06.2026', '2026-06-05'],
    ['2026-06-05', '2026-06-05'],
    ['5 June 2026', '2026-06-05'],
    ['5th Jun 2026', '2026-06-05'],
    ['05-Jun-2026', '2026-06-05'],
    ['June 5, 2026', '2026-06-05'],
    ['29/02/2028', '2028-02-29'],
  ])('reads %s', (text, iso) => {
    expect(parseDate(text)).toBe(iso);
  });

  it.each(['31/02/2026', '29/02/2026', '13/13/2026', '00/01/2026', 'tomorrow', '', '5 Foo 2026'])('rejects %j', (text) => {
    expect(parseDate(text)).toBeNull();
  });

  it('prints day first', () => {
    expect(formatDate('2026-06-05')).toBe('05/06/2026');
    expect(formatDate('')).toBe('');
    expect(formatDate('2026-02-31')).toBe('');
  });

  it('validates ISO dates', () => {
    expect(isValidIsoDate('2026-06-05')).toBe(true);
    expect(isValidIsoDate('2026-6-5')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
  });

  it('finds a date inside other text', () => {
    expect(findDateInText('05/06/2026 Ref 44')).toBe('05/06/2026');
    expect(findDateInText('on 5th June 2026 approx')).toBe('5th June 2026');
    expect(findDateInText('no date here')).toBeNull();
  });

  it('shows saved timestamps in local time, whatever the time zone', () => {
    const afternoon = new Date(2026, 5, 5, 14, 30).toISOString(); // stored as UTC
    expect(formatTimestamp(afternoon)).toBe('05/06/2026 14:30');
    const lateEvening = new Date(2026, 5, 5, 23, 59).toISOString();
    expect(formatTimestampDate(lateEvening)).toBe('05/06/2026');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('garbage')).toBe('');
  });

  it('warns about post-dated and stale cheques', () => {
    expect(dateWarning('2026-06-06', '2026-06-05')).toBe('post_dated');
    expect(dateWarning('2026-06-05', '2026-06-05')).toBeNull();
    expect(dateWarning('2025-12-05', '2026-06-05')).toBeNull();
    expect(dateWarning('2025-12-04', '2026-06-05')).toBe('stale');
  });
});
