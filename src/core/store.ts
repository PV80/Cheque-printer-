// Every change to the saved data goes through a function in this file.
// Each one checks the user's permission, makes the change on a copy, and
// writes a line to the activity log. Nothing here touches the screen or disk.

import { formatMoney } from './amount';
import { can, normaliseUsername, usernameProblem, type Permission } from './auth';
import { findNameConflict, FORM_TYPES, matchCompany, normaliseCompanyName } from './company';
import { formatDate, isValidIsoDate } from './dates';
import { createIssueChecker, hasOverride, normaliseChequeNumber, normalisePayee } from './issues';
import { DEFAULT_TEMPLATE, FIELD_KEYS, type Measure } from './layout';
import type {
  AuditEntry,
  Cheque,
  ChequeTemplate,
  CompanyProfile,
  FieldPosition,
  FontFamily,
  OverrideKind,
  Requisition,
  Settings,
  SignatureResult,
  SignatureZone,
  Store,
  User,
} from './types';

export class StoreError extends Error {}

export type Actor = Pick<User, 'id' | 'displayName' | 'role'>;

export interface Ctx {
  actor: Actor;
  now: string; // ISO timestamp
  newId: () => string;
}

export const DEFAULT_SETTINGS: Settings = { autoLockMinutes: 15 };

export function emptyStore(): Store {
  return { version: 1, users: [], companies: [], cheques: [], audit: [], settings: { ...DEFAULT_SETTINGS } };
}

// ---- Helpers ------------------------------------------------------------------

function requirePermission(ctx: Ctx, permission: Permission): void {
  if (!can(ctx.actor, permission)) throw new StoreError('You do not have permission to do this.');
}

function withLog(store: Store, ctx: Ctx, action: string, details: string, chequeId?: string): Store {
  const entry: AuditEntry = {
    id: ctx.newId(),
    at: ctx.now,
    userId: ctx.actor.id,
    userName: ctx.actor.displayName,
    action,
    details,
    ...(chequeId ? { chequeId } : {}),
  };
  return { ...store, audit: [...store.audit, entry] };
}

/** For events that change no records, e.g. signing in or exporting. */
export function logEvent(store: Store, ctx: Ctx, action: string, details: string): Store {
  return withLog(store, ctx, action, details);
}

function getCheque(store: Store, id: string): Cheque {
  const cheque = store.cheques.find((c) => c.id === id);
  if (!cheque) throw new StoreError('That cheque no longer exists.');
  return cheque;
}

function getPending(store: Store, id: string): Cheque {
  const cheque = getCheque(store, id);
  if (cheque.status !== 'pending') throw new StoreError('Only cheques that have not been printed can be changed.');
  return cheque;
}

/** A waiting cheque that is not sitting in the printer awaiting a result. */
function getEditable(store: Store, id: string): Cheque {
  const cheque = getPending(store, id);
  if (cheque.printSentAt) throw new StoreError('Record what happened at the printer for this cheque first.');
  return cheque;
}

function putCheque(store: Store, cheque: Cheque): Store {
  return { ...store, cheques: store.cheques.map((c) => (c.id === cheque.id ? cheque : c)) };
}

export function describeCheque(c: Cheque): string {
  return `cheque ${c.chequeNumber || '(no number)'} — ${c.payee || 'no payee'} — KES ${formatMoney(c.amountCents)}`;
}

const UNCHECKED: SignatureResult = { status: 'unchecked' };

function resetSignatures(cheque: Cheque): Cheque {
  return { ...cheque, requisitions: cheque.requisitions.map((r) => ({ ...r, signature: UNCHECKED })) };
}

// ---- Loading and saving the data file --------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const FONT_FAMILIES: FontFamily[] = ['Arial', 'Courier New', 'Times New Roman'];

function sanitizeField(raw: unknown, fallback: FieldPosition): FieldPosition {
  if (!isObject(raw)) return { ...fallback };
  const field: FieldPosition = {
    x: num(raw.x, fallback.x),
    y: num(raw.y, fallback.y),
    width: Math.max(1, num(raw.width, fallback.width)),
    fontSize: clamp(num(raw.fontSize, fallback.fontSize), 5, 30),
    fontFamily: FONT_FAMILIES.includes(raw.fontFamily as FontFamily) ? (raw.fontFamily as FontFamily) : fallback.fontFamily,
    fontWeight: raw.fontWeight === 'bold' ? 'bold' : 'normal',
    align: raw.align === 'center' || raw.align === 'right' ? raw.align : 'left',
  };
  const wrap = typeof raw.wrap === 'boolean' ? raw.wrap : fallback.wrap;
  if (wrap) {
    field.wrap = true;
    field.height = Math.max(1, num(raw.height, fallback.height ?? 18));
    const spacing = num(raw.lineSpacing, 0);
    if (spacing > 0) field.lineSpacing = spacing;
  }
  return field;
}

function sanitizeTemplate(raw: unknown): ChequeTemplate {
  const t = isObject(raw) ? raw : {};
  const f = isObject(t.fields) ? t.fields : {};
  const fields = {} as ChequeTemplate['fields'];
  for (const key of FIELD_KEYS) fields[key] = sanitizeField(f[key], DEFAULT_TEMPLATE.fields[key]);
  const sheetHeight = clamp(num(t.sheetHeight, 0), 0, 500);
  return {
    chequeWidth: clamp(num(t.chequeWidth, DEFAULT_TEMPLATE.chequeWidth), 50, 400),
    chequeHeight: clamp(num(t.chequeHeight, DEFAULT_TEMPLATE.chequeHeight), 30, 400),
    pageTopOffset: clamp(num(t.pageTopOffset, 0), 0, 400),
    ...(sheetHeight > 0 ? { sheetHeight } : {}),
    fields,
  };
}

function sanitizeZone(raw: unknown): SignatureZone | null {
  if (!isObject(raw)) return null;
  const x = num(raw.x, -1);
  const y = num(raw.y, -1);
  const w = num(raw.w, 0);
  const h = num(raw.h, 0);
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) return null;
  const zone: SignatureZone = {
    page: Math.max(1, Math.round(num(raw.page, 1))),
    x,
    y,
    w,
    h,
    ignoreTypedText: raw.ignoreTypedText !== false,
  };
  if (isObject(raw.anchor) && typeof raw.anchor.text === 'string' && raw.anchor.text.trim()) {
    zone.anchor = { text: raw.anchor.text.trim().toLowerCase(), dx: num(raw.anchor.dx, 0), dy: num(raw.anchor.dy, 0) };
  }
  return zone;
}

function sanitizeZones(raw: unknown): CompanyProfile['signatureZones'] {
  const zones: CompanyProfile['signatureZones'] = {};
  if (!isObject(raw)) return zones;
  for (const type of FORM_TYPES) {
    // Earlier versions kept a single box per form.
    const list = (Array.isArray(raw[type]) ? raw[type] : [raw[type]])
      .map(sanitizeZone)
      .filter((z): z is SignatureZone => z !== null);
    if (list.length) zones[type] = list;
  }
  return zones;
}

function cleanAliases(name: string, aliases: unknown): string[] {
  const seen = new Set([normaliseCompanyName(name)]);
  const out: string[] = [];
  for (const a of Array.isArray(aliases) ? aliases : []) {
    if (typeof a !== 'string') continue;
    const key = normaliseCompanyName(a);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a.trim());
  }
  return out;
}

/** Accepts a company from a saved file or an older version and fills any gaps. */
export function sanitizeCompany(raw: unknown): CompanyProfile | null {
  if (!isObject(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const name = raw.name.trim();
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name,
    aliases: cleanAliases(name, raw.aliases),
    ...(typeof raw.bankAccount === 'string' && raw.bankAccount.trim() ? { bankAccount: raw.bankAccount.trim() } : {}),
    printerType: raw.printerType === 'dot_matrix' ? 'dot_matrix' : 'laser',
    printerName: typeof raw.printerName === 'string' ? raw.printerName : '',
    printerOffsetX: clamp(num(raw.printerOffsetX, 0), -100, 100),
    printerOffsetY: clamp(num(raw.printerOffsetY, 0), -100, 100),
    template: sanitizeTemplate(raw.template),
    signatureZones: sanitizeZones(raw.signatureZones),
    loadingNote: typeof raw.loadingNote === 'string' ? raw.loadingNote : '',
  };
}

export function newCompany(id: string, name: string): CompanyProfile {
  return sanitizeCompany({ id, name })!;
}

export function serializeStore(store: Store): string {
  return JSON.stringify(store);
}

export function parseStore(json: string): Store {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new StoreError('The data file is not readable.');
  }
  if (!isObject(raw) || typeof raw.version !== 'number') throw new StoreError('This is not a Cheque Printer data file.');
  if (raw.version > 1) throw new StoreError('This data was saved by a newer version of Cheque Printer. Update the app.');

  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const companies = list(raw.companies)
    .map(sanitizeCompany)
    .filter((c): c is CompanyProfile => c !== null && c.id !== '');

  const cheques = list(raw.cheques)
    .filter(isObject)
    .map((c) => ({
      statusNote: '',
      edited: false,
      amountConfirmed: false,
      overrides: [],
      requisitions: [],
      ...c,
    })) as unknown as Cheque[];

  return {
    version: 1,
    users: list(raw.users).filter(isObject) as unknown as User[],
    companies,
    cheques,
    audit: list(raw.audit).filter(isObject) as unknown as AuditEntry[],
    settings: { ...DEFAULT_SETTINGS, ...(isObject(raw.settings) ? (raw.settings as Partial<Settings>) : {}) },
  };
}

// ---- Users --------------------------------------------------------------------

export type NewUser = Pick<User, 'username' | 'displayName' | 'role' | 'salt' | 'hash'>;

function buildUser(store: Store, input: NewUser, id: string, now: string): User {
  const username = normaliseUsername(input.username);
  const problem = usernameProblem(username);
  if (problem) throw new StoreError(problem);
  if (!input.displayName.trim()) throw new StoreError('Enter the person\'s name.');
  if (store.users.some((u) => u.username === username)) throw new StoreError(`Username "${username}" is already taken.`);
  return {
    id,
    username,
    displayName: input.displayName.trim(),
    role: input.role,
    salt: input.salt,
    hash: input.hash,
    active: true,
    createdAt: now,
  };
}

/** The very first account. Only possible while no users exist. */
export function createFirstAdmin(store: Store, input: NewUser, id: string, now: string): Store {
  if (store.users.length > 0) throw new StoreError('An administrator already exists.');
  const user = buildUser(store, { ...input, role: 'admin' }, id, now);
  const ctx: Ctx = { actor: user, now, newId: () => `${id}-log` };
  return withLog({ ...store, users: [user] }, ctx, 'Created administrator', user.username);
}

export function addUser(store: Store, ctx: Ctx, input: NewUser): Store {
  requirePermission(ctx, 'manage_users');
  const user = buildUser(store, input, ctx.newId(), ctx.now);
  return withLog({ ...store, users: [...store.users, user] }, ctx, 'Added user', `${user.username} (${user.role})`);
}

export function updateUser(
  store: Store,
  ctx: Ctx,
  id: string,
  patch: Partial<Pick<User, 'displayName' | 'role' | 'active' | 'salt' | 'hash'>>
): Store {
  requirePermission(ctx, 'manage_users');
  const user = store.users.find((u) => u.id === id);
  if (!user) throw new StoreError('That user no longer exists.');
  const updated: User = { ...user, ...patch };
  if (!updated.displayName.trim()) throw new StoreError('Enter the person\'s name.');

  const users = store.users.map((u) => (u.id === id ? updated : u));
  if (!users.some((u) => u.role === 'admin' && u.active)) {
    throw new StoreError('There must always be at least one active administrator.');
  }

  const changes: string[] = [];
  if (patch.role && patch.role !== user.role) changes.push(`role ${user.role} → ${patch.role}`);
  if (patch.active !== undefined && patch.active !== user.active) changes.push(patch.active ? 'reactivated' : 'deactivated');
  if (patch.hash && patch.hash !== user.hash) changes.push('password reset');
  if (patch.displayName && patch.displayName !== user.displayName) changes.push('renamed');
  return withLog({ ...store, users }, ctx, 'Updated user', `${user.username}: ${changes.join(', ') || 'no change'}`);
}

export function changeOwnPassword(store: Store, ctx: Ctx, salt: string, hash: string): Store {
  if (!store.users.some((u) => u.id === ctx.actor.id)) throw new StoreError('That user no longer exists.');
  const users = store.users.map((u) => (u.id === ctx.actor.id ? { ...u, salt, hash } : u));
  return withLog({ ...store, users }, ctx, 'Changed own password', '');
}

// ---- Companies ------------------------------------------------------------------

function autoAssign(store: Store): Store {
  // Requisitions waiting for a company pick it up as soon as its name is known.
  let changed = false;
  const cheques = store.cheques.map((c) => {
    if (c.status !== 'pending' || c.companyId) return c;
    const match = matchCompany(c.companyRaw, store.companies);
    if (!match) return c;
    changed = true;
    return resetSignatures({ ...c, companyId: match.id });
  });
  return changed ? { ...store, cheques } : store;
}

export function saveCompany(store: Store, ctx: Ctx, input: CompanyProfile): Store {
  requirePermission(ctx, 'manage_companies');
  const company = sanitizeCompany(input);
  if (!company || !company.id) throw new StoreError('Enter the company name.');

  const conflict = findNameConflict(company, store.companies);
  if (conflict) throw new StoreError(`The name "${conflict.name}" is already used by ${conflict.other.name}.`);

  const existing = store.companies.find((c) => c.id === company.id);
  let next: Store = {
    ...store,
    companies: existing
      ? store.companies.map((c) => (c.id === company.id ? company : c))
      : [...store.companies, company],
  };

  // A moved signature box means earlier checks no longer apply.
  if (existing && JSON.stringify(existing.signatureZones) !== JSON.stringify(company.signatureZones)) {
    next = {
      ...next,
      cheques: next.cheques.map((c) => (c.status === 'pending' && c.companyId === company.id ? resetSignatures(c) : c)),
    };
  }

  next = autoAssign(next);
  return withLog(next, ctx, existing ? 'Saved company' : 'Added company', company.name);
}

export function deleteCompany(store: Store, ctx: Ctx, id: string): Store {
  requirePermission(ctx, 'manage_companies');
  const company = store.companies.find((c) => c.id === id);
  if (!company) return store;
  if (store.cheques.some((c) => c.companyId === id && (c.status === 'printed' || c.status === 'spoiled' || c.printSentAt))) {
    throw new StoreError(`${company.name} has cheques in the register and cannot be deleted.`);
  }
  const cheques = store.cheques.map((c) => (c.companyId === id ? resetSignatures({ ...c, companyId: null }) : c));
  return withLog({ ...store, companies: store.companies.filter((c) => c.id !== id), cheques }, ctx, 'Deleted company', company.name);
}

export function assignCompany(store: Store, ctx: Ctx, chequeId: string, companyId: string): Store {
  requirePermission(ctx, 'assign_company');
  const cheque = getEditable(store, chequeId);
  const company = store.companies.find((c) => c.id === companyId);
  if (!company) throw new StoreError('That company no longer exists.');

  // Remember the name as printed on the requisition, unless another company owns it.
  let companies = store.companies;
  const raw = cheque.companyRaw.trim();
  if (raw && !matchCompany(raw, store.companies)) {
    const withAlias = { ...company, aliases: [...company.aliases, raw] };
    if (!findNameConflict(withAlias, store.companies)) {
      companies = store.companies.map((c) => (c.id === company.id ? withAlias : c));
    }
  }

  const rawKey = normaliseCompanyName(raw);
  const cheques = store.cheques.map((c) => {
    const sameUnassigned = c.status === 'pending' && !c.companyId && rawKey !== '' && normaliseCompanyName(c.companyRaw) === rawKey;
    if (c.id !== chequeId && !sameUnassigned) return c;
    return resetSignatures({ ...c, companyId });
  });

  return withLog({ ...store, companies, cheques }, ctx, 'Assigned company', `${describeCheque(cheque)} → ${company.name}`, chequeId);
}

export interface LayoutImportResult {
  store: Store;
  added: number;
  updated: number;
  skipped: string[];
}

/** Brings in company layouts from an export file. Matches existing companies by name. */
export function importCompanyLayouts(store: Store, ctx: Ctx, incoming: unknown[]): LayoutImportResult {
  requirePermission(ctx, 'manage_companies');
  let next = store;
  let added = 0;
  let updated = 0;
  const skipped: string[] = [];

  for (const raw of incoming) {
    const company = sanitizeCompany(raw);
    if (!company) continue;
    const existing = matchCompany(company.name, next.companies);
    try {
      if (existing) {
        next = saveCompany(next, ctx, {
          ...company,
          id: existing.id,
          name: existing.name,
          aliases: [...existing.aliases, ...company.aliases.filter((a) => !matchCompany(a, next.companies))],
          bankAccount: company.bankAccount ?? existing.bankAccount,
        });
        updated++;
      } else {
        next = saveCompany(next, ctx, { ...company, id: ctx.newId() });
        added++;
      }
    } catch (err) {
      if (!(err instanceof StoreError)) throw err;
      skipped.push(`${company.name}: ${err.message}`);
    }
  }
  return { store: next, added, updated, skipped };
}

export function updateSettings(store: Store, ctx: Ctx, patch: Partial<Settings>): Store {
  requirePermission(ctx, 'manage_data');
  const settings = { ...store.settings, ...patch };
  settings.autoLockMinutes = clamp(Math.round(num(settings.autoLockMinutes, 15)), 0, 240);
  return withLog({ ...store, settings }, ctx, 'Changed settings', `auto sign-out: ${settings.autoLockMinutes || 'off'} min`);
}

// ---- Loading requisitions ---------------------------------------------------------

export type HashCheck =
  | { known: false }
  | { known: true; cheque: Cheque; reason: 'already_loaded' | 'already_printed' | 'spoiled' };

/** Has this exact PDF been dropped before? */
export function checkFileHash(store: Store, fileHash: string): HashCheck {
  const cheque = store.cheques.find((c) => c.status !== 'cancelled' && c.requisitions.some((r) => r.fileHash === fileHash));
  if (!cheque) return { known: false };
  const reason = cheque.status === 'pending' ? 'already_loaded' : cheque.status === 'printed' ? 'already_printed' : 'spoiled';
  return { known: true, cheque, reason };
}

export function chequeFromRequisition(req: Requisition, companyId: string | null, id: string, now: string): Cheque {
  return {
    id,
    companyId,
    companyRaw: req.companyRaw,
    chequeNumber: req.chequeNumber,
    payee: req.payee,
    date: req.date,
    amountCents: req.amountCents,
    requisitions: [req],
    status: 'pending',
    statusNote: '',
    edited: false,
    amountConfirmed: false,
    overrides: [],
    createdAt: now,
  };
}

export interface AddResult {
  store: Store;
  /** The unsigned copy this signed one took the place of, if any. */
  replaced: Cheque | null;
}

export function addCheque(store: Store, ctx: Ctx, cheque: Cheque): AddResult {
  requirePermission(ctx, 'import');
  if (store.cheques.some((c) => c.id === cheque.id)) throw new StoreError('That requisition is already loaded.');

  // A signed copy of a requisition that was held as unsigned simply replaces it.
  const req = cheque.requisitions[0];
  const number = normaliseChequeNumber(cheque.chequeNumber);
  const unsignedTwin =
    cheque.companyId && number && req?.signature.status === 'signed'
      ? store.cheques.find(
          (c) =>
            c.status === 'pending' &&
            c.companyId === cheque.companyId &&
            normaliseChequeNumber(c.chequeNumber) === number &&
            c.requisitions.length === 1 &&
            c.requisitions[0].signature.status === 'not_signed' &&
            !hasOverride(c, 'unsigned') &&
            normalisePayee(c.payee) === normalisePayee(cheque.payee) &&
            c.amountCents === cheque.amountCents
        )
      : undefined;

  let next: Store = { ...store, cheques: [...store.cheques, cheque] };
  next = withLog(next, ctx, 'Loaded requisition', `${req?.filename ?? ''} — ${describeCheque(cheque)}`, cheque.id);

  if (unsignedTwin) {
    next = putCheque(next, { ...unsignedTwin, status: 'cancelled', statusNote: `Replaced by signed copy (${req.filename})` });
    next = withLog(next, ctx, 'Replaced unsigned copy', describeCheque(unsignedTwin), unsignedTwin.id);
  }
  return { store: next, replaced: unsignedTwin ?? null };
}

export function setSignatureResult(store: Store, chequeId: string, requisitionId: string, result: SignatureResult): Store {
  const cheque = store.cheques.find((c) => c.id === chequeId);
  if (!cheque || cheque.status !== 'pending') return store;
  return putCheque(store, {
    ...cheque,
    requisitions: cheque.requisitions.map((r) => (r.id === requisitionId ? { ...r, signature: result } : r)),
  });
}

// ---- Changing a waiting cheque -----------------------------------------------------

export interface ChequeEdit {
  payee: string;
  date: string; // ISO
  amountCents: number;
  chequeNumber: string;
}

export function editCheque(store: Store, ctx: Ctx, id: string, edit: ChequeEdit): Store {
  requirePermission(ctx, 'edit_cheque');
  const cheque = getEditable(store, id);

  const payee = edit.payee.trim().replace(/\s+/g, ' ');
  const chequeNumber = edit.chequeNumber.trim();
  if (!payee) throw new StoreError('Enter the payee.');
  if (!isValidIsoDate(edit.date)) throw new StoreError('Enter a valid date.');
  if (!Number.isSafeInteger(edit.amountCents) || edit.amountCents <= 0) throw new StoreError('Enter a valid amount.');
  if (!/^\d{1,12}$/.test(chequeNumber) || normaliseChequeNumber(chequeNumber) === '') {
    throw new StoreError('Enter the cheque number (digits only).');
  }

  const changes: string[] = [];
  if (payee !== cheque.payee) changes.push(`payee "${cheque.payee}" → "${payee}"`);
  if (edit.date !== cheque.date) changes.push(`date ${formatDate(cheque.date) || '(none)'} → ${formatDate(edit.date)}`);
  if (edit.amountCents !== cheque.amountCents) {
    changes.push(`amount ${formatMoney(cheque.amountCents)} → ${formatMoney(edit.amountCents)}`);
  }
  if (chequeNumber !== cheque.chequeNumber) changes.push(`cheque number ${cheque.chequeNumber || '(none)'} → ${chequeNumber}`);

  // A release of a possible double payment was for the old details; changed details are judged afresh.
  const samePayment = payee === cheque.payee && edit.date === cheque.date && edit.amountCents === cheque.amountCents;
  const updated: Cheque = {
    ...cheque,
    payee,
    date: edit.date,
    amountCents: edit.amountCents,
    chequeNumber,
    edited: cheque.edited || changes.length > 0,
    amountConfirmed: true,
    overrides: samePayment ? cheque.overrides : cheque.overrides.filter((o) => o.kind !== 'duplicate_payment'),
  };
  return withLog(
    putCheque(store, updated),
    ctx,
    changes.length ? 'Edited cheque' : 'Confirmed cheque details',
    changes.length ? changes.join('; ') : describeCheque(updated),
    id
  );
}

const OVERRIDE_LABEL: Record<OverrideKind, string> = {
  unsigned: 'not signed',
  duplicate_payment: 'possible double payment',
};

/** ctx.actor is the approver. `requestedByName` is whoever was at the keyboard. */
export function addOverride(
  store: Store,
  ctx: Ctx,
  chequeId: string,
  kind: OverrideKind,
  reason: string,
  requestedByName: string
): Store {
  requirePermission(ctx, 'override');
  const cheque = getPending(store, chequeId);
  const text = reason.trim();
  if (text.length < 5) throw new StoreError('Give a reason for the override.');

  // An "unsigned" release names the requisitions it covers, so it cannot be
  // stretched over one that is added to the cheque later.
  const requisitionIds =
    kind === 'unsigned' ? cheque.requisitions.filter((r) => r.signature.status !== 'signed').map((r) => r.id) : undefined;
  const overrides = [
    ...cheque.overrides.filter((o) => o.kind !== kind),
    {
      kind,
      ...(requisitionIds ? { requisitionIds } : {}),
      byUserId: ctx.actor.id,
      byName: ctx.actor.displayName,
      requestedByName,
      reason: text,
      at: ctx.now,
    },
  ];
  const asked = requestedByName && requestedByName !== ctx.actor.displayName ? ` (requested by ${requestedByName})` : '';
  return withLog(
    putCheque(store, { ...cheque, overrides }),
    ctx,
    'Override',
    `${OVERRIDE_LABEL[kind]} — ${describeCheque(cheque)} — reason: ${text}${asked}`,
    chequeId
  );
}

export function cancelCheque(store: Store, ctx: Ctx, id: string, note: string): Store {
  requirePermission(ctx, 'discard');
  const cheque = getEditable(store, id);
  const statusNote = note.trim() || 'Discarded';
  return withLog(
    putCheque(store, { ...cheque, status: 'cancelled', statusNote }),
    ctx,
    'Discarded requisition',
    `${describeCheque(cheque)} — ${statusNote}`,
    id
  );
}

/** Clears several waiting requisitions at once, e.g. a company's whole print queue. */
export function cancelCheques(store: Store, ctx: Ctx, ids: string[], note: string): Store {
  return ids.reduce((next, id) => cancelCheque(next, ctx, id, note), store);
}

/**
 * Two requisitions that are paid by one cheque: `mergeId` is folded into
 * `keepId` and the amounts are added together.
 */
export function combineCheques(store: Store, ctx: Ctx, keepId: string, mergeId: string): Store {
  requirePermission(ctx, 'resolve_duplicate');
  if (keepId === mergeId) throw new StoreError('Pick two different requisitions.');
  const keep = getEditable(store, keepId);
  const merge = getEditable(store, mergeId);

  if (!keep.companyId || keep.companyId !== merge.companyId) {
    throw new StoreError('Both requisitions must belong to the same company.');
  }
  if (normaliseChequeNumber(keep.chequeNumber) !== normaliseChequeNumber(merge.chequeNumber)) {
    throw new StoreError('Both requisitions must use the same cheque number.');
  }
  if (!normalisePayee(keep.payee) || normalisePayee(keep.payee) !== normalisePayee(merge.payee)) {
    throw new StoreError('The payees differ. One cheque can only pay one payee.');
  }

  const combined: Cheque = {
    ...keep,
    amountCents: keep.amountCents + merge.amountCents,
    date: merge.date > keep.date ? merge.date : keep.date,
    requisitions: [...keep.requisitions, ...merge.requisitions],
    edited: keep.edited || merge.edited,
    amountConfirmed: keep.amountConfirmed && merge.amountConfirmed,
    // Each "unsigned" release stays tied to the requisitions it was given for.
    // A double-payment release was for the old amount, so it is dropped.
    overrides: [keep, merge].flatMap((c) =>
      c.overrides
        .filter((o) => o.kind === 'unsigned')
        .map((o) => ({ ...o, requisitionIds: o.requisitionIds ?? c.requisitions.map((r) => r.id) }))
    ),
  };

  const next = { ...store, cheques: store.cheques.filter((c) => c.id !== mergeId).map((c) => (c.id === keepId ? combined : c)) };
  return withLog(
    next,
    ctx,
    'Combined requisitions',
    `cheque ${keep.chequeNumber}: ${formatMoney(keep.amountCents)} + ${formatMoney(merge.amountCents)} = ${formatMoney(combined.amountCents)} to ${keep.payee}`,
    keepId
  );
}

// ---- Printing ---------------------------------------------------------------------

/** Final gate before anything is sent to the printer. */
export function assertPrintable(store: Store, ctx: Ctx, ids: string[], measure?: Measure): Cheque[] {
  requirePermission(ctx, 'print');
  if (ids.length === 0) throw new StoreError('Nothing selected to print.');
  const check = createIssueChecker(store, measure);
  const cheques = ids.map((id) => getCheque(store, id));

  const companyIds = new Set(cheques.map((c) => c.companyId));
  if (companyIds.size !== 1) throw new StoreError('Print one company at a time.');

  for (const cheque of cheques) {
    if (cheque.status !== 'pending') throw new StoreError(`Cheque ${cheque.chequeNumber} has already been dealt with.`);
    const issues = check(cheque);
    if (issues.length) throw new StoreError(`Cheque ${cheque.chequeNumber} cannot be printed: ${issues[0].message}`);
  }
  return cheques;
}

/**
 * Written to disk just before a job goes to the printer. If the app is closed
 * before the result is recorded, these cheques are held instead of printing twice.
 */
export function markSentToPrinter(store: Store, ctx: Ctx, ids: string[]): Store {
  requirePermission(ctx, 'print');
  let next = store;
  const numbers: string[] = [];
  for (const id of ids) {
    const cheque = getPending(next, id);
    numbers.push(cheque.chequeNumber);
    next = putCheque(next, { ...cheque, printSentAt: ctx.now });
  }
  return withLog(next, ctx, 'Sent to printer', `cheques ${numbers.join(', ')}`);
}

/** The job never reached the printer (cancelled or refused): nothing to record. */
export function clearSentToPrinter(store: Store, ctx: Ctx, ids: string[], reason: string): Store {
  requirePermission(ctx, 'print');
  let next = store;
  const numbers: string[] = [];
  for (const id of ids) {
    const cheque = next.cheques.find((c) => c.id === id);
    if (!cheque || cheque.status !== 'pending' || !cheque.printSentAt) continue;
    const { printSentAt: _sent, ...rest } = cheque;
    numbers.push(cheque.chequeNumber);
    next = putCheque(next, rest);
  }
  return numbers.length ? withLog(next, ctx, 'Print did not start', `cheques ${numbers.join(', ')} — ${reason}`) : next;
}

export interface PrintOutcome {
  id: string;
  outcome: 'printed' | 'spoiled' | 'not_printed';
  note?: string;
}

export function recordPrintResults(store: Store, ctx: Ctx, outcomes: PrintOutcome[]): Store {
  requirePermission(ctx, 'print');
  let next = store;
  for (const { id, outcome, note } of outcomes) {
    const { printSentAt: _sent, ...cheque } = getPending(next, id);
    if (outcome === 'printed') {
      next = putCheque(next, { ...cheque, status: 'printed', printedAt: ctx.now, printedByName: ctx.actor.displayName });
      next = withLog(next, ctx, 'Printed', describeCheque(cheque), id);
    } else if (outcome === 'spoiled') {
      const statusNote = note?.trim() || 'Spoiled while printing';
      next = putCheque(next, {
        ...cheque,
        status: 'spoiled',
        statusNote,
        printedAt: ctx.now,
        printedByName: ctx.actor.displayName,
      });
      next = withLog(next, ctx, 'Spoiled', `${describeCheque(cheque)} — ${statusNote}`, id);
    } else {
      next = putCheque(next, cheque);
      next = withLog(next, ctx, 'Did not print', `${describeCheque(cheque)} — leaf unused, still in queue`, id);
    }
  }
  return next;
}

/** A printed cheque later found to be unusable. Its number stays used. */
export function markSpoiled(store: Store, ctx: Ctx, id: string, note: string): Store {
  requirePermission(ctx, 'mark_spoiled');
  const cheque = getCheque(store, id);
  if (cheque.status !== 'printed') throw new StoreError('Only a printed cheque can be marked spoiled.');
  const statusNote = note.trim();
  if (statusNote.length < 3) throw new StoreError('Say what went wrong with the cheque.');
  return withLog(putCheque(store, { ...cheque, status: 'spoiled', statusNote }), ctx, 'Marked spoiled', `${describeCheque(cheque)} — ${statusNote}`, id);
}

/**
 * Restoring a backup must never make a used cheque printable again. Every
 * cheque printed or spoiled in the current data keeps that status in the
 * restored data, whether or not the backup knew about it.
 */
export function reconcileRestore(current: Store, restored: Store): Store {
  const used = current.cheques.filter((c) => c.status === 'printed' || c.status === 'spoiled');
  const usedById = new Map(used.map((c) => [c.id, c]));
  const restoredIds = new Set(restored.cheques.map((c) => c.id));
  return {
    ...restored,
    cheques: [
      ...restored.cheques.map((c) => (c.status === 'pending' || c.status === 'cancelled' ? usedById.get(c.id) ?? c : c)),
      ...used.filter((c) => !restoredIds.has(c.id)),
    ],
  };
}

// ---- Sharing the register between computers ------------------------------------------
//
// Each computer keeps its own register. So that one computer knows which
// cheque numbers another has already used, the register of used cheques can
// be saved to a file on one and taken in on the other.

export interface RegisterShare {
  type: 'cheque-printer-register';
  version: 1;
  sharedAt: string;
  sharedBy: string;
  companies: CompanyProfile[];
  cheques: Cheque[];
}

const isUsed = (c: Cheque) => c.status === 'printed' || c.status === 'spoiled';

/** Every cheque printed or spoiled on this computer, with the companies they belong to. */
export function shareRegister(store: Store, sharedBy: string, now: string): RegisterShare {
  const cheques = store.cheques.filter((c) => isUsed(c) && c.companyId);
  const companyIds = new Set(cheques.map((c) => c.companyId));
  return {
    type: 'cheque-printer-register',
    version: 1,
    sharedAt: now,
    sharedBy,
    companies: store.companies.filter((c) => companyIds.has(c.id)),
    cheques,
  };
}

export interface RegisterMergeResult {
  store: Store;
  added: number; // used cheques this computer did not know about
  known: number; // already recorded here
  companiesAdded: string[];
  /** Cheque numbers both computers have used, for different payments. */
  clashes: string[];
}

function sanitizeSharedCheque(raw: unknown): Cheque | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.chequeNumber !== 'string') return null;
  if (raw.status !== 'printed' && raw.status !== 'spoiled') return null;
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    id: raw.id,
    companyId: typeof raw.companyId === 'string' ? raw.companyId : null,
    companyRaw: text(raw.companyRaw),
    chequeNumber: raw.chequeNumber,
    payee: text(raw.payee),
    date: text(raw.date),
    amountCents: Number.isSafeInteger(raw.amountCents) ? (raw.amountCents as number) : 0,
    requisitions: (Array.isArray(raw.requisitions) ? raw.requisitions.filter(isObject) : []) as unknown as Requisition[],
    status: raw.status,
    statusNote: text(raw.statusNote),
    edited: raw.edited === true,
    amountConfirmed: raw.amountConfirmed === true,
    overrides: (Array.isArray(raw.overrides) ? raw.overrides.filter(isObject) : []) as unknown as Cheque['overrides'],
    createdAt: text(raw.createdAt),
    ...(typeof raw.printedAt === 'string' ? { printedAt: raw.printedAt } : {}),
    ...(typeof raw.printedByName === 'string' ? { printedByName: raw.printedByName } : {}),
  };
}

/**
 * Takes in another computer's used cheques. Their numbers then count as used
 * here too: a requisition for one of them is held, and the queue knows where
 * that company's cheque book has got to. Nothing already recorded here is changed.
 */
export function mergeRegister(store: Store, ctx: Ctx, raw: unknown): RegisterMergeResult {
  requirePermission(ctx, 'sync_register');
  if (!isObject(raw) || raw.type !== 'cheque-printer-register' || !Array.isArray(raw.cheques)) {
    throw new StoreError('That file is not a register shared from Cheque Printer.');
  }
  const from = `${typeof raw.sharedBy === 'string' && raw.sharedBy ? raw.sharedBy : 'another computer'}, ${
    typeof raw.sharedAt === 'string' ? formatDate(raw.sharedAt.slice(0, 10)) : 'date unknown'
  }`;

  // Match the other computer's companies to ours by name; bring over any we do not have, layout included.
  let companies = store.companies;
  const companiesAdded: string[] = [];
  const localId = new Map<string, string>();
  for (const item of Array.isArray(raw.companies) ? raw.companies : []) {
    const theirs = sanitizeCompany(item);
    if (!theirs || !theirs.id) continue;
    const ours =
      companies.find((c) => c.id === theirs.id) ??
      [theirs.name, ...theirs.aliases].map((n) => matchCompany(n, companies)).find((c) => c !== null);
    if (ours) {
      localId.set(theirs.id, ours.id);
    } else if (!findNameConflict(theirs, companies)) {
      companies = [...companies, theirs];
      companiesAdded.push(theirs.name);
      localId.set(theirs.id, theirs.id);
    }
  }

  let cheques = store.cheques;
  let added = 0;
  let known = 0;
  const clashes: string[] = [];
  for (const item of raw.cheques) {
    const theirs = sanitizeSharedCheque(item);
    const companyId = theirs?.companyId ? localId.get(theirs.companyId) : undefined;
    if (!theirs || !companyId) continue;
    const number = normaliseChequeNumber(theirs.chequeNumber);

    const sameRecord = cheques.find((c) => c.id === theirs.id);
    const sameLeaf = cheques.find((c) => c.id !== theirs.id && c.companyId === companyId && isUsed(c) && normaliseChequeNumber(c.chequeNumber) === number);
    if (sameRecord && isUsed(sameRecord)) {
      known++;
    } else if (sameLeaf) {
      known++;
      // The same leaf number used on both computers for different payments: someone needs to look.
      if (normalisePayee(sameLeaf.payee) !== normalisePayee(theirs.payee) || sameLeaf.amountCents !== theirs.amountCents) {
        clashes.push(theirs.chequeNumber);
      }
    } else {
      const record: Cheque = { ...theirs, companyId, receivedFrom: from };
      cheques = sameRecord ? cheques.map((c) => (c.id === theirs.id ? record : c)) : [...cheques, record];
      added++;
    }
  }

  const details =
    `from ${from}: ${added} added, ${known} already known` +
    (companiesAdded.length ? `, companies added: ${companiesAdded.join(', ')}` : '') +
    (clashes.length ? `, CLASH on cheque ${clashes.join(', ')}` : '');
  return { store: withLog({ ...store, companies, cheques }, ctx, 'Received register', details), added, known, companiesAdded, clashes };
}

/** Undo "printed" when the leaf was never actually used. */
export function revertPrinted(store: Store, ctx: Ctx, id: string, note: string): Store {
  requirePermission(ctx, 'revert_printed');
  const cheque = getCheque(store, id);
  if (cheque.status !== 'printed') throw new StoreError('Only a printed cheque can be put back in the queue.');
  const reason = note.trim();
  if (reason.length < 3) throw new StoreError('Say why this is being undone.');
  const { printedAt: _at, printedByName: _by, ...rest } = cheque;
  return withLog(putCheque(store, { ...rest, status: 'pending' }), ctx, 'Put back in queue', `${describeCheque(cheque)} — ${reason}`, id);
}
