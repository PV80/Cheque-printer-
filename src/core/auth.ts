// Users, roles and passwords.
//
// This keeps honest people honest and records who did what. It is not a vault:
// someone with full access to the computer's files could still tamper with
// the data file directly.

import type { Role, User } from './types';

export type Permission =
  | 'import' // drop requisitions
  | 'print' // print queued cheques and report the result
  | 'discard' // discard a requisition that has not been printed
  | 'resolve_duplicate' // combine or replace requisitions sharing a cheque number
  | 'edit_cheque' // change payee, date, amount or cheque number
  | 'assign_company'
  | 'override' // release an unsigned requisition or a possible double payment
  | 'mark_spoiled' // mark an already-printed cheque as spoiled later
  | 'sync_register' // take in the register shared from another computer
  | 'revert_printed' // undo "printed" when the leaf was never actually used
  | 'manage_companies' // layouts, signature boxes, printers
  | 'manage_users'
  | 'manage_data'; // backup, restore, settings

const OPERATOR: Permission[] = ['import', 'print', 'discard', 'resolve_duplicate'];
const SUPERVISOR: Permission[] = [...OPERATOR, 'edit_cheque', 'assign_company', 'override', 'mark_spoiled', 'sync_register'];
const ADMIN: Permission[] = [...SUPERVISOR, 'revert_printed', 'manage_companies', 'manage_users', 'manage_data'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  operator: OPERATOR,
  supervisor: SUPERVISOR,
  admin: ADMIN,
};

export const ROLE_LABELS: Record<Role, string> = {
  operator: 'Operator',
  supervisor: 'Supervisor',
  admin: 'Administrator',
};

export const ROLE_SUMMARY: Record<Role, string> = {
  operator: 'Drops requisitions and prints signed cheques. Cannot override or edit.',
  supervisor: 'Everything an operator can do, plus edit details and override with a logged reason.',
  admin: 'Everything, plus companies, cheque layouts, users and backups.',
};

export function can(user: Pick<User, 'role'> | null | undefined, permission: Permission): boolean {
  return !!user && ROLE_PERMISSIONS[user.role].includes(permission);
}

export const MIN_PASSWORD_LENGTH = 8;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

export function normaliseUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function usernameProblem(username: string): string | null {
  return /^[a-z0-9._-]{3,30}$/.test(normaliseUsername(username))
    ? null
    : 'Username must be 3-30 characters: letters, numbers, dot, dash or underscore.';
}

const PBKDF2_ITERATIONS = 210_000;

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => new Uint8Array((hex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return toHex(new Uint8Array(bits));
}

/** Passwords are never stored — only a salted, slow hash. */
export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { salt: toHex(salt), hash: await derive(password, salt) };
}

export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const candidate = await derive(password, fromHex(salt));
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/** Checks a username and password against the user list. */
export async function authenticate(users: User[], username: string, password: string): Promise<User | null> {
  const user = users.find((u) => u.username === normaliseUsername(username) && u.active);
  if (!user) return null;
  return (await verifyPassword(password, user.salt, user.hash)) ? user : null;
}
