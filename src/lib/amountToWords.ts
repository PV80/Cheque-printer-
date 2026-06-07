const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function convertHundreds(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rem = n % 10;
    return TENS[Math.floor(n / 10)] + (rem ? ' ' + ONES[rem] : '');
  }
  const rem = n % 100;
  return ONES[Math.floor(n / 100)] + ' Hundred' + (rem ? ' ' + convertHundreds(rem) : '');
}

export function amountToWords(amount: number): string {
  const whole = Math.round(amount);
  if (whole === 0) return 'Zero Kenya Shillings Only';

  const parts: string[] = [];

  const billions = Math.floor(whole / 1_000_000_000);
  const millions = Math.floor((whole % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((whole % 1_000_000) / 1_000);
  const remainder = whole % 1_000;

  if (billions) parts.push(convertHundreds(billions) + ' Billion');
  if (millions) parts.push(convertHundreds(millions) + ' Million');
  if (thousands) parts.push(convertHundreds(thousands) + ' Thousand');
  if (remainder) parts.push(convertHundreds(remainder));

  return parts.join(' ') + ' Kenya Shillings Only';
}

export function parseAmountString(raw: string): number {
  // Handle formats: 15,000/=  |  KSh 58,000.00  |  15000  |  58,000
  const cleaned = raw.replace(/KSh\s*/i, '').replace(/[,\s]/g, '').replace('/=', '').replace('=', '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}
