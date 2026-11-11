import type { CompanyProfile, DocumentType } from './types';

export const FORM_TYPES: DocumentType[] = ['requisition_voucher', 'payment_receipt', 'unknown'];

export const FORM_LABELS: Record<DocumentType, string> = {
  requisition_voucher: 'Cheque requisition voucher',
  payment_receipt: 'Payment receipt (from the accounts system)',
  unknown: 'Other form',
};

/**
 * Reduces a company name to a comparable form: case, punctuation and the
 * Ltd/Limited spelling no longer matter, but every word still does.
 */
export function normaliseCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\blimited\b/g, 'ltd')
    .replace(/\bcompany\b/g, 'co')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

export function companyNames(company: Pick<CompanyProfile, 'name' | 'aliases'>): string[] {
  return [company.name, ...company.aliases];
}

/**
 * Finds the company a requisition belongs to. The whole name must match one
 * of the company's known names — "Golden Ivy Investments" never matches
 * "Golden Ivy Properties". Returns null when nothing or more than one matches.
 */
export function matchCompany(rawName: string, companies: CompanyProfile[]): CompanyProfile | null {
  const wanted = normaliseCompanyName(rawName);
  if (!wanted) return null;
  const hits = companies.filter((c) => companyNames(c).some((n) => normaliseCompanyName(n) === wanted));
  return hits.length === 1 ? hits[0] : null;
}

/** The other company already using one of these names, if any. */
export function findNameConflict(
  company: Pick<CompanyProfile, 'id' | 'name' | 'aliases'>,
  companies: CompanyProfile[]
): { name: string; other: CompanyProfile } | null {
  for (const name of companyNames(company)) {
    const wanted = normaliseCompanyName(name);
    if (!wanted) continue;
    const other = companies.find(
      (c) => c.id !== company.id && companyNames(c).some((n) => normaliseCompanyName(n) === wanted)
    );
    if (other) return { name, other };
  }
  return null;
}
