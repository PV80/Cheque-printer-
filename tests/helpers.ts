import { newCompany, type Ctx } from '../src/core/store';
import type { Measure } from '../src/core/layout';
import type { Cheque, CompanyProfile, Requisition, Role, Store, User } from '../src/core/types';

let counter = 0;
export const nextId = () => `id-${++counter}`;

export function makeUser(role: Role, name = role): User {
  return {
    id: `user-${name}`,
    username: name,
    displayName: name[0].toUpperCase() + name.slice(1),
    role,
    salt: '00',
    hash: '00',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

export const admin = makeUser('admin');
export const supervisor = makeUser('supervisor');
export const operator = makeUser('operator');

export function ctxFor(user: User, now = '2026-06-05T09:00:00.000Z'): Ctx {
  return { actor: user, now, newId: nextId };
}

export function makeCompany(name: string, overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    ...newCompany(nextId(), name),
    signatureZone: { page: 1, x: 0.5, y: 0.8, w: 0.3, h: 0.08, ignoreTypedText: true },
    ...overrides,
  };
}

export function makeRequisition(overrides: Partial<Requisition> = {}): Requisition {
  const id = nextId();
  return {
    id,
    filename: `${id}.pdf`,
    fileHash: id.padStart(64, '0'),
    importedAt: '2026-06-05T08:00:00.000Z',
    importedById: operator.id,
    importedByName: operator.displayName,
    documentType: 'requisition_voucher',
    companyRaw: 'GOLDEN IVY INVESTMENTS LTD',
    payee: 'Paul Angalushe',
    dateRaw: '05/06/2026',
    date: '2026-06-05',
    amountCents: 5_800_000,
    amountWordsRaw: 'Fifty Eight Thousand Only',
    wordsCents: 5_800_000,
    chequeNumber: '000123',
    signature: { status: 'signed' },
    ...overrides,
  };
}

export function makeCheque(company: CompanyProfile | null, overrides: Partial<Cheque> & { req?: Partial<Requisition> } = {}): Cheque {
  const { req: reqOverrides, ...rest } = overrides;
  const base = {
    chequeNumber: rest.chequeNumber ?? '000123',
    payee: rest.payee ?? 'Paul Angalushe',
    date: rest.date ?? '2026-06-05',
    amountCents: rest.amountCents ?? 5_800_000,
  };
  const req = makeRequisition({ ...base, wordsCents: base.amountCents, ...reqOverrides });
  return {
    id: nextId(),
    companyId: company?.id ?? null,
    companyRaw: company?.name ?? 'Unknown Co',
    ...base,
    requisitions: [req],
    status: 'pending',
    statusNote: '',
    edited: false,
    amountConfirmed: false,
    overrides: [],
    createdAt: `2026-06-05T08:00:${String(counter % 60).padStart(2, '0')}.000Z`,
    ...rest,
  };
}

export function makeStore(companies: CompanyProfile[], cheques: Cheque[] = []): Store {
  return {
    version: 1,
    users: [admin, supervisor, operator],
    companies,
    cheques,
    audit: [],
    settings: { autoLockMinutes: 15 },
  };
}

/** Stand-in for real font measurement: every character is half the font size wide. */
export const fakeMeasure: Measure = (text, fontPt) => text.length * fontPt * 0.5 * (25.4 / 72);
