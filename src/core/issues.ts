// Decides whether a cheque may be printed. A pending cheque with no issues is
// in the print queue; one with any issue is held, and the issue says why.

import { formatMoney } from './amount';
import { dateWarning, formatTimestamp, formatTimestampDate, isValidIsoDate } from './dates';
import { chequeValues, layoutCheque, type Measure } from './layout';
import type { Cheque, OverrideKind, Store } from './types';

export type IssueKind =
  | 'print_unconfirmed'
  | 'no_company'
  | 'missing_fields'
  | 'amount_mismatch'
  | 'signature_zone_missing'
  | 'signature_unchecked'
  | 'unsigned'
  | 'duplicate_number'
  | 'duplicate_payment'
  | 'text_too_long';

export interface Issue {
  kind: IssueKind;
  message: string;
  /** The other cheque involved, for duplicates. */
  relatedChequeId?: string;
  /** True when nothing in the app can clear it (e.g. the leaf was already used). */
  hard?: boolean;
}

export function normaliseChequeNumber(n: string): string {
  return n.replace(/\D/g, '').replace(/^0+/, '');
}

export function normalisePayee(p: string): string {
  return p.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hasOverride(cheque: Cheque, kind: OverrideKind): boolean {
  return cheque.overrides.some((o) => o.kind === kind);
}

/** Every requisition behind the cheque is signed, or an approver has overridden. */
export function isSigned(cheque: Cheque): boolean {
  if (hasOverride(cheque, 'unsigned')) return true;
  return cheque.requisitions.length > 0 && cheque.requisitions.every((r) => r.signature.status === 'signed');
}

function numberKey(c: Cheque): string | null {
  const n = normaliseChequeNumber(c.chequeNumber);
  return c.companyId && n ? `${c.companyId}|${n}` : null;
}

function paymentKey(c: Cheque): string | null {
  const payee = normalisePayee(c.payee);
  if (!c.companyId || !payee || c.amountCents <= 0 || !isValidIsoDate(c.date)) return null;
  return `${c.companyId}|${payee}|${c.amountCents}|${c.date}`;
}

const isOlder = (a: Cheque, b: Cheque) => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);

/**
 * Builds a checker for the current data. Pass `measure` to also catch text
 * that cannot fit on the cheque.
 */
export function createIssueChecker(store: Store, measure?: Measure): (cheque: Cheque) => Issue[] {
  const companies = new Map(store.companies.map((c) => [c.id, c]));
  const byNumber = new Map<string, Cheque[]>();
  const byPayment = new Map<string, Cheque[]>();
  const push = (map: Map<string, Cheque[]>, key: string | null, c: Cheque) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(c);
    else map.set(key, [c]);
  };
  for (const c of store.cheques) {
    if (c.status !== 'cancelled') push(byNumber, numberKey(c), c);
    if (c.status === 'pending' || c.status === 'printed') push(byPayment, paymentKey(c), c);
  }

  return (cheque) => {
    const issues: Issue[] = [];
    const company = cheque.companyId ? companies.get(cheque.companyId) : undefined;

    // A job went to the printer and the app was closed or signed out before
    // anyone said what came out. Until that is recorded it must not print again.
    if (cheque.printSentAt) {
      issues.push({
        kind: 'print_unconfirmed',
        message: `Sent to the printer on ${formatTimestamp(cheque.printSentAt)}, but what happened was never recorded. Check the leaf, then record the result.`,
      });
    }

    if (!company) {
      issues.push({
        kind: 'no_company',
        message: cheque.companyRaw
          ? `Company "${cheque.companyRaw}" is not recognised.`
          : 'No company name was found on the requisition.',
      });
    }

    const missing: string[] = [];
    if (!cheque.payee.trim()) missing.push('payee');
    if (!isValidIsoDate(cheque.date)) missing.push('date');
    if (!Number.isSafeInteger(cheque.amountCents) || cheque.amountCents <= 0) missing.push('amount');
    if (!/^\d{1,12}$/.test(cheque.chequeNumber)) missing.push('cheque number');
    if (missing.length) {
      issues.push({ kind: 'missing_fields', message: `Could not read: ${missing.join(', ')}.` });
    }

    if (!cheque.amountConfirmed) {
      for (const r of cheque.requisitions) {
        if (r.wordsCents !== null && r.wordsCents !== r.amountCents) {
          issues.push({
            kind: 'amount_mismatch',
            message: `Amount in words (${formatMoney(r.wordsCents)}) does not match figures (${formatMoney(r.amountCents)}) on ${r.filename}.`,
          });
          break;
        }
        if (r.amountWordsRaw.trim() && r.wordsCents === null) {
          issues.push({
            kind: 'amount_mismatch',
            message: `Amount in words on ${r.filename} could not be read, so the figures cannot be confirmed.`,
          });
          break;
        }
      }
    }

    if (company && !hasOverride(cheque, 'unsigned')) {
      const unsigned = cheque.requisitions.filter((r) => r.signature.status === 'not_signed');
      const unchecked = cheque.requisitions.filter((r) => r.signature.status === 'unchecked');
      if (unsigned.length || cheque.requisitions.length === 0) {
        issues.push({
          kind: 'unsigned',
          message:
            cheque.requisitions.length > 1
              ? `Not signed: ${unsigned.map((r) => r.filename).join(', ')}.`
              : 'The requisition is not signed.',
        });
      } else if (unchecked.length) {
        issues.push(
          company.signatureZone
            ? { kind: 'signature_unchecked', message: 'The signature has not been checked yet.' }
            : {
                kind: 'signature_zone_missing',
                message: `The signature box for ${company.name} requisitions has not been set up.`,
              }
        );
      }
    }

    const nKey = numberKey(cheque);
    if (nKey) {
      const others = (byNumber.get(nKey) ?? []).filter((o) => o.id !== cheque.id);
      const used = others.find((o) => o.status === 'printed' || o.status === 'spoiled');
      const waiting = others.find((o) => o.status === 'pending');
      if (used) {
        const when = used.printedAt ? ` on ${formatTimestampDate(used.printedAt)}` : '';
        issues.push({
          kind: 'duplicate_number',
          hard: true,
          relatedChequeId: used.id,
          message: `Cheque ${used.chequeNumber} was already ${used.status === 'printed' ? 'printed' : 'marked spoiled'}${when}. A leaf cannot be used twice.`,
        });
      } else if (waiting) {
        issues.push({
          kind: 'duplicate_number',
          relatedChequeId: waiting.id,
          message: `Another requisition (${waiting.payee || 'no payee'}, ${formatMoney(waiting.amountCents)}) also uses cheque ${cheque.chequeNumber}.`,
        });
      }
    }

    const pKey = paymentKey(cheque);
    if (pKey && !hasOverride(cheque, 'duplicate_payment')) {
      const mine = normaliseChequeNumber(cheque.chequeNumber);
      const twin = (byPayment.get(pKey) ?? []).find(
        (o) =>
          o.id !== cheque.id &&
          normaliseChequeNumber(o.chequeNumber) !== mine &&
          (o.status === 'printed' || isOlder(o, cheque))
      );
      if (twin) {
        issues.push({
          kind: 'duplicate_payment',
          relatedChequeId: twin.id,
          message: `Same payee, amount and date as cheque ${twin.chequeNumber} (${twin.status === 'printed' ? 'already printed' : 'waiting to print'}). Possible double payment.`,
        });
      }
    }

    if (company && measure && missing.length === 0) {
      const overflow = layoutCheque(chequeValues(cheque), company, measure).overflow;
      if (overflow.length) {
        const names = overflow.map((k) => (k === 'amountWords' ? 'amount in words' : k === 'amountFigures' ? 'amount' : k));
        issues.push({
          kind: 'text_too_long',
          message: `Too long to fit on the cheque: ${names.join(', ')}. Shorten it or widen the field in the company layout.`,
        });
      }
    }

    return issues;
  };
}

/** Things worth a second look that do not stop printing. */
export function getWarnings(cheque: Cheque, today: string): string[] {
  const warnings: string[] = [];
  const w = dateWarning(cheque.date, today);
  if (w === 'post_dated') warnings.push('Dated in the future');
  if (w === 'stale') warnings.push('Dated more than 6 months ago');
  if (cheque.edited) warnings.push('Details edited by hand');
  if (hasOverride(cheque, 'unsigned')) warnings.push('Signature overridden');
  if (cheque.requisitions.length > 1) warnings.push(`${cheque.requisitions.length} requisitions combined`);
  return warnings;
}
