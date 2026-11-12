import { describe, expect, it } from 'vitest';
import { authenticate, can, hashPassword, verifyPassword } from '../src/core/auth';
import { formatTimestamp } from '../src/core/dates';
import { createIssueChecker, getWarnings, isSigned } from '../src/core/issues';
import { buildQueue, compareChequeNumbers, findMissingNumbers } from '../src/core/queue';
import { activityCsv, registerCsv } from '../src/core/register';
import {
  addCheque,
  addOverride,
  addUser,
  assertPrintable,
  assignCompany,
  cancelCheque,
  cancelCheques,
  checkFileHash,
  clearSentToPrinter,
  combineCheques,
  createFirstAdmin,
  deleteCompany,
  editCheque,
  emptyStore,
  importCompanyLayouts,
  markSentToPrinter,
  markSpoiled,
  mergeRegister,
  parseStore,
  reconcileRestore,
  recordPrintResults,
  revertPrinted,
  saveCompany,
  serializeStore,
  shareRegister,
  StoreError,
  updateUser,
} from '../src/core/store';
import { admin, ctxFor, fakeMeasure, makeCheque, makeCompany, makeStore, operator, supervisor } from './helpers';

const kinds = (issues: { kind: string }[]) => issues.map((i) => i.kind);

describe('print queue order', () => {
  it('sorts cheque numbers as numbers, not text', () => {
    expect(['100', '99', '000101', '5'].sort(compareChequeNumbers)).toEqual(['5', '99', '100', '000101']);
  });

  it('groups by company, each ascending by cheque number', () => {
    const zed = makeCompany('Zed Ltd');
    const alpha = makeCompany('Alpha Ltd');
    const store = makeStore(
      [zed, alpha],
      [
        makeCheque(zed, { chequeNumber: '000130', payee: 'A' }),
        makeCheque(alpha, { chequeNumber: '000900', payee: 'B' }),
        makeCheque(zed, { chequeNumber: '000123', payee: 'C' }),
        makeCheque(alpha, { chequeNumber: '000099', payee: 'D' }),
        makeCheque(zed, { chequeNumber: '000124', payee: 'E' }),
      ]
    );
    const check = createIssueChecker(store);
    const queue = buildQueue(store, (c) => check(c).length === 0);
    expect(queue.map((g) => g.company.name)).toEqual(['Alpha Ltd', 'Zed Ltd']);
    expect(queue[0].cheques.map((c) => c.chequeNumber)).toEqual(['000099', '000900']);
    expect(queue[1].cheques.map((c) => c.chequeNumber)).toEqual(['000123', '000124', '000130']);
  });

  it('leaves held, printed and discarded cheques out of the queue', () => {
    const co = makeCompany('Alpha Ltd');
    const store = makeStore(
      [co],
      [
        makeCheque(co, { chequeNumber: '000001' }),
        makeCheque(co, { chequeNumber: '000002', payee: 'B', req: { signature: { status: 'not_signed' } } }),
        makeCheque(co, { chequeNumber: '000003', payee: 'C', status: 'printed' }),
        makeCheque(co, { chequeNumber: '000004', payee: 'D', status: 'cancelled' }),
      ]
    );
    const check = createIssueChecker(store);
    const queue = buildQueue(store, (c) => check(c).length === 0);
    expect(queue).toHaveLength(1);
    expect(queue[0].cheques.map((c) => c.chequeNumber)).toEqual(['000001']);
    expect(queue[0].lastPrinted).toBe('000003');
  });

  it('lists leaves that must come out of the stack', () => {
    const missing = findMissingNumbers(['000123', '000124', '000126', '000130'], new Set(['127']));
    expect(missing).toEqual([
      { from: '000125', to: '000125', count: 1 },
      { from: '000128', to: '000129', count: 2 },
    ]);
    expect(findMissingNumbers(['000123', '000124', '000125'], new Set())).toEqual([]);
    expect(findMissingNumbers(['000123'], new Set())).toEqual([]);
  });
});

describe('issues that hold a cheque', () => {
  const co = makeCompany('Alpha Ltd');

  it('a complete, signed requisition has none', () => {
    const cheque = makeCheque(co);
    expect(createIssueChecker(makeStore([co], [cheque]), fakeMeasure)(cheque)).toEqual([]);
    expect(isSigned(cheque)).toBe(true);
  });

  it('a layout that pushes a field off the sheet holds the cheque and says so plainly', () => {
    const shifted = makeCompany('Shifted Ltd', { printerOffsetY: -15 });
    shifted.template.fields.date.y = 7.9;
    const cheque = makeCheque(shifted);
    const issues = createIssueChecker(makeStore([shifted], [cheque]), fakeMeasure)(cheque);
    expect(kinds(issues)).toEqual(['layout_off_sheet']);
    expect(issues[0].message).toContain('cannot print the date (7.1 mm above the top of the sheet)');
    expect(issues[0].message).not.toMatch(/too long/i);

    // Correcting the layout releases it: nothing about the cheque itself was wrong.
    const corrected = { ...shifted, printerOffsetY: 0, template: { ...shifted.template, sheetHeight: 115 } };
    expect(createIssueChecker(makeStore([corrected], [cheque]), fakeMeasure)(cheque)).toEqual([]);
  });

  it('text that is too long is still reported as too long', () => {
    const cheque = makeCheque(co, { payee: 'X'.repeat(400) });
    const issues = createIssueChecker(makeStore([co], [cheque]), fakeMeasure)(cheque);
    expect(kinds(issues)).toEqual(['text_too_long']);
    expect(issues[0].message).toContain('Too long to fit on the cheque: payee');
  });

  it('unsigned is held until an approver overrides', () => {
    const cheque = makeCheque(co, { req: { signature: { status: 'not_signed' } } });
    let store = makeStore([co], [cheque]);
    expect(kinds(createIssueChecker(store)(cheque))).toEqual(['unsigned']);
    expect(isSigned(cheque)).toBe(false);

    store = addOverride(store, ctxFor(supervisor), cheque.id, 'unsigned', 'Brian approved by phone', 'Operator');
    const after = store.cheques[0];
    expect(createIssueChecker(store)(after)).toEqual([]);
    expect(isSigned(after)).toBe(true);
    expect(getWarnings(after, '2026-06-05')).toContain('Signature overridden');
  });

  it('is held when the signature box is not set up, or the check has not run', () => {
    const noZone = makeCompany('NoZone Ltd', { signatureZones: {} });
    const a = makeCheque(noZone, { req: { signature: { status: 'unchecked' } } });
    const b = makeCheque(co, { req: { signature: { status: 'unchecked' } }, chequeNumber: '000200', payee: 'B' });
    const check = createIssueChecker(makeStore([co, noZone], [a, b]));
    expect(kinds(check(a))).toEqual(['signature_zone_missing']);
    expect(kinds(check(b))).toEqual(['signature_unchecked']);
  });

  it('is held without a company or with unreadable fields', () => {
    const cheque = makeCheque(null, { payee: '', date: '', amountCents: 0, chequeNumber: '' });
    const issues = createIssueChecker(makeStore([co], [cheque]))(cheque);
    expect(kinds(issues)).toEqual(['no_company', 'missing_fields']);
    expect(issues[1].message).toBe('Could not read: payee, date (written as 05/06/2026), amount, cheque number.');
  });

  it('is held when words and figures disagree, until confirmed', () => {
    const cheque = makeCheque(co, { req: { wordsCents: 5_000_000 } });
    const store = makeStore([co], [cheque]);
    expect(kinds(createIssueChecker(store)(cheque))).toEqual(['amount_mismatch']);

    const confirmed = editCheque(store, ctxFor(supervisor), cheque.id, {
      payee: cheque.payee,
      date: cheque.date,
      amountCents: cheque.amountCents,
      chequeNumber: cheque.chequeNumber,
    });
    expect(createIssueChecker(confirmed)(confirmed.cheques[0])).toEqual([]);
  });

  it('is held when the words cannot be read at all', () => {
    const cheque = makeCheque(co, { req: { amountWordsRaw: 'Fifty eight thou5and', wordsCents: null } });
    expect(kinds(createIssueChecker(makeStore([co], [cheque]))(cheque))).toEqual(['amount_mismatch']);
  });

  it('blocks a cheque number that was already printed or spoiled', () => {
    for (const status of ['printed', 'spoiled'] as const) {
      const used = makeCheque(co, { status, printedAt: '2026-06-01T10:00:00.000Z' });
      const again = makeCheque(co, { payee: 'Someone Else', amountCents: 100_000 });
      const issues = createIssueChecker(makeStore([co], [used, again]))(again);
      expect(kinds(issues)).toEqual(['duplicate_number']);
      expect(issues[0].hard).toBe(true);
      expect(issues[0].message).toContain('A leaf cannot be used twice');
    }
  });

  it('treats 123 and 000123 as the same leaf', () => {
    const used = makeCheque(co, { status: 'printed', chequeNumber: '123' });
    const again = makeCheque(co, { chequeNumber: '000123', payee: 'Other' });
    expect(kinds(createIssueChecker(makeStore([co], [used, again]))(again))).toEqual(['duplicate_number']);
  });

  it('holds both when two waiting requisitions share a cheque number', () => {
    const a = makeCheque(co, { payee: 'A', amountCents: 100_000 });
    const b = makeCheque(co, { payee: 'B', amountCents: 200_000 });
    const check = createIssueChecker(makeStore([co], [a, b]));
    expect(kinds(check(a))).toEqual(['duplicate_number']);
    expect(kinds(check(b))).toEqual(['duplicate_number']);
    expect(check(a)[0].hard).toBeUndefined();
  });

  it('the same number at a different company is fine', () => {
    const other = makeCompany('Beta Ltd');
    const a = makeCheque(co);
    const b = makeCheque(other, { payee: 'B' });
    const check = createIssueChecker(makeStore([co, other], [a, b]));
    expect(check(a)).toEqual([]);
    expect(check(b)).toEqual([]);
  });

  it('a discarded requisition does not block its number', () => {
    const old = makeCheque(co, { status: 'cancelled' });
    const fresh = makeCheque(co);
    expect(createIssueChecker(makeStore([co], [old, fresh]))(fresh)).toEqual([]);
  });

  it('flags the same payment on a new cheque number — unless the first was spoiled', () => {
    const first = makeCheque(co, { status: 'printed', chequeNumber: '000123' });
    const redo = makeCheque(co, { chequeNumber: '000124' });
    expect(kinds(createIssueChecker(makeStore([co], [first, redo]))(redo))).toEqual(['duplicate_payment']);

    const spoiled = { ...first, status: 'spoiled' as const };
    expect(createIssueChecker(makeStore([co], [spoiled, redo]))(redo)).toEqual([]);
  });

  it('flags only the newer of two waiting look-alike payments', () => {
    const older = makeCheque(co, { chequeNumber: '000123', createdAt: '2026-06-05T08:00:00.000Z' });
    const newer = makeCheque(co, { chequeNumber: '000124', createdAt: '2026-06-05T08:05:00.000Z' });
    const check = createIssueChecker(makeStore([co], [older, newer]));
    expect(check(older)).toEqual([]);
    expect(kinds(check(newer))).toEqual(['duplicate_payment']);
  });

  it('a monthly payment on a different date is not a duplicate', () => {
    const june = makeCheque(co, { status: 'printed', chequeNumber: '000123', date: '2026-06-05' });
    const july = makeCheque(co, { chequeNumber: '000150', date: '2026-07-05' });
    expect(createIssueChecker(makeStore([co], [june, july]))(july)).toEqual([]);
  });

  it('holds a cheque whose text cannot fit', () => {
    const cheque = makeCheque(co, { payee: 'X'.repeat(400) });
    expect(kinds(createIssueChecker(makeStore([co], [cheque]), fakeMeasure)(cheque))).toEqual(['text_too_long']);
  });

  it('holds a requisition the reader had doubts about until a supervisor checks it', () => {
    const cheque = makeCheque(co, { req: { reviewNotes: ['The payee may run on to the next line ("Welfare Association").'] } });
    const store = makeStore([co], [cheque]);
    const issues = createIssueChecker(store)(cheque);
    expect(kinds(issues)).toEqual(['needs_review']);
    expect(issues[0].message).toContain('payee may run on');
    expect(() => assertPrintable(store, ctxFor(operator), [cheque.id])).toThrow(StoreError);

    const checked = editCheque(store, ctxFor(supervisor), cheque.id, {
      payee: 'Paul Angalushe Welfare Association',
      date: cheque.date,
      amountCents: cheque.amountCents,
      chequeNumber: cheque.chequeNumber,
    });
    expect(createIssueChecker(checked)(checked.cheques[0])).toEqual([]);
  });

  it('needs a signature box for each kind of form the company uses', () => {
    const receipt = makeCheque(co, { req: { documentType: 'payment_receipt', signature: { status: 'unchecked' } } });
    const issues = createIssueChecker(makeStore([co], [receipt]))(receipt);
    expect(kinds(issues)).toEqual(['signature_zone_missing']);
    expect(issues[0].message).toContain('Payment receipt');
  });

  it('does not accept 0 or 000 as a cheque number', () => {
    const cheque = makeCheque(co, { chequeNumber: '000' });
    const store = makeStore([co], [cheque]);
    expect(kinds(createIssueChecker(store)(cheque))).toEqual(['missing_fields']);
    const edit = { payee: 'A', date: '2026-06-05', amountCents: 100, chequeNumber: '0' };
    expect(() => editCheque(store, ctxFor(supervisor), cheque.id, edit)).toThrow('cheque number');
  });

  it('warns about dates without blocking', () => {
    const future = makeCheque(co, { date: '2026-07-01' });
    expect(createIssueChecker(makeStore([co], [future]))(future)).toEqual([]);
    expect(getWarnings(future, '2026-06-05')).toEqual(['Dated in the future']);
    expect(getWarnings(makeCheque(co, { date: '2025-01-01' }), '2026-06-05')).toEqual(['Dated more than 6 months ago']);
  });
});

describe('permissions', () => {
  const co = makeCompany('Alpha Ltd');
  const unsigned = () => makeCheque(co, { req: { signature: { status: 'not_signed' } } });

  it('operators cannot override, edit, assign or manage', () => {
    const cheque = unsigned();
    const store = makeStore([co], [cheque]);
    const ctx = ctxFor(operator);
    const edit = { payee: 'X', date: '2026-06-05', amountCents: 100, chequeNumber: '1' };
    expect(() => addOverride(store, ctx, cheque.id, 'unsigned', 'because I said so', 'Operator')).toThrow(StoreError);
    expect(() => editCheque(store, ctx, cheque.id, edit)).toThrow(StoreError);
    expect(() => assignCompany(store, ctx, cheque.id, co.id)).toThrow(StoreError);
    expect(() => saveCompany(store, ctx, co)).toThrow(StoreError);
    expect(() => addUser(store, ctx, { username: 'x12', displayName: 'X', role: 'admin', salt: '', hash: '' })).toThrow(StoreError);
    expect(can(operator, 'override')).toBe(false);
    expect(can(operator, 'print')).toBe(true);
  });

  it('supervisors can override and edit but not manage users or companies', () => {
    const cheque = unsigned();
    const store = makeStore([co], [cheque]);
    const ctx = ctxFor(supervisor);
    expect(() => addOverride(store, ctx, cheque.id, 'unsigned', 'Approved by phone', 'Operator')).not.toThrow();
    expect(() => saveCompany(store, ctx, co)).toThrow(StoreError);
    expect(() => updateUser(store, ctx, operator.id, { role: 'admin' })).toThrow(StoreError);
    expect(() => revertPrinted(store, ctx, cheque.id, 'reason')).toThrow(StoreError);
  });

  it('an override needs a real reason and is logged with both names', () => {
    const cheque = unsigned();
    const store = makeStore([co], [cheque]);
    expect(() => addOverride(store, ctxFor(supervisor), cheque.id, 'unsigned', '  ok ', 'Operator')).toThrow('reason');

    const next = addOverride(store, ctxFor(supervisor), cheque.id, 'unsigned', 'Brian approved by phone', 'Operator');
    expect(next.cheques[0].overrides[0]).toMatchObject({
      kind: 'unsigned',
      byName: 'Supervisor',
      requestedByName: 'Operator',
      reason: 'Brian approved by phone',
    });
    const entry = next.audit[next.audit.length - 1];
    expect(entry.action).toBe('Override');
    expect(entry.userName).toBe('Supervisor');
    expect(entry.details).toContain('Brian approved by phone');
    expect(entry.details).toContain('requested by Operator');
  });

  it('there is always at least one active administrator', () => {
    const store = makeStore([co]);
    expect(() => updateUser(store, ctxFor(admin), admin.id, { active: false })).toThrow('administrator');
    expect(() => updateUser(store, ctxFor(admin), admin.id, { role: 'operator' })).toThrow('administrator');
    expect(() => updateUser(store, ctxFor(admin), operator.id, { role: 'supervisor' })).not.toThrow();
  });

  it('the first account is always an administrator, and only once', () => {
    const store = createFirstAdmin(emptyStore(), { username: 'Brian', displayName: 'Brian', role: 'operator', salt: 's', hash: 'h' }, 'u1', '2026-01-01T00:00:00.000Z');
    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({ username: 'brian', role: 'admin', active: true });
    expect(() => createFirstAdmin(store, { username: 'eve', displayName: 'Eve', role: 'admin', salt: 's', hash: 'h' }, 'u2', '')).toThrow(StoreError);
  });

  it('usernames are unique', () => {
    const store = makeStore([co]);
    expect(() => addUser(store, ctxFor(admin), { username: 'Operator', displayName: 'Dup', role: 'operator', salt: '', hash: '' })).toThrow('already taken');
  });
});

describe('passwords', () => {
  it('verifies the right password only', async () => {
    const { salt, hash } = await hashPassword('correct horse');
    expect(hash).toHaveLength(64);
    expect(await verifyPassword('correct horse', salt, hash)).toBe(true);
    expect(await verifyPassword('wrong horse', salt, hash)).toBe(false);
    const again = await hashPassword('correct horse');
    expect(again.hash).not.toBe(hash);
  });

  it('refuses unknown and deactivated users', async () => {
    const creds = await hashPassword('secret-pass');
    const brian = { ...admin, username: 'brian', ...creds };
    const gone = { ...operator, username: 'gone', ...creds, active: false };
    expect((await authenticate([brian, gone], ' Brian ', 'secret-pass'))?.id).toBe(brian.id);
    expect(await authenticate([brian, gone], 'brian', 'nope')).toBeNull();
    expect(await authenticate([brian, gone], 'gone', 'secret-pass')).toBeNull();
    expect(await authenticate([brian, gone], 'nobody', 'secret-pass')).toBeNull();
  });
});

describe('loading requisitions', () => {
  const co = makeCompany('Alpha Ltd');

  it('recognises a PDF it has seen before', () => {
    const pending = makeCheque(co);
    const printed = makeCheque(co, { status: 'printed', chequeNumber: '000200', payee: 'B' });
    const cancelled = makeCheque(co, { status: 'cancelled', chequeNumber: '000300', payee: 'C' });
    const store = makeStore([co], [pending, printed, cancelled]);
    expect(checkFileHash(store, pending.requisitions[0].fileHash)).toMatchObject({ known: true, reason: 'already_loaded' });
    expect(checkFileHash(store, printed.requisitions[0].fileHash)).toMatchObject({ known: true, reason: 'already_printed' });
    expect(checkFileHash(store, cancelled.requisitions[0].fileHash)).toEqual({ known: false });
    expect(checkFileHash(store, 'f'.repeat(64))).toEqual({ known: false });
  });

  it('a signed copy replaces the unsigned one that was being held', () => {
    const unsigned = makeCheque(co, { req: { signature: { status: 'not_signed' } } });
    const signed = makeCheque(co);
    const { store, replaced } = addCheque(makeStore([co], [unsigned]), ctxFor(operator), signed);
    expect(replaced?.id).toBe(unsigned.id);
    expect(store.cheques.find((c) => c.id === unsigned.id)).toMatchObject({ status: 'cancelled' });
    expect(createIssueChecker(store)(signed)).toEqual([]);
  });

  it('does not auto-replace when payee or amount differ', () => {
    const unsigned = makeCheque(co, { req: { signature: { status: 'not_signed' } }, amountCents: 100_000 });
    const signed = makeCheque(co);
    const { store, replaced } = addCheque(makeStore([co], [unsigned]), ctxFor(operator), signed);
    expect(replaced).toBeNull();
    expect(kinds(createIssueChecker(store)(signed))).toEqual(['duplicate_number']);
  });
});

describe('resolving two requisitions on one cheque number', () => {
  const co = makeCompany('Alpha Ltd');

  it('combines them into one cheque for the total', () => {
    const a = makeCheque(co, { amountCents: 1_500_000 });
    const b = makeCheque(co, { amountCents: 2_000_050, date: '2026-06-07' });
    const store = combineCheques(makeStore([co], [a, b]), ctxFor(operator), a.id, b.id);
    expect(store.cheques).toHaveLength(1);
    expect(store.cheques[0]).toMatchObject({ id: a.id, amountCents: 3_500_050, date: '2026-06-07' });
    expect(store.cheques[0].requisitions).toHaveLength(2);
    expect(createIssueChecker(store)(store.cheques[0])).toEqual([]);
    expect(store.audit[store.audit.length - 1].details).toContain('15,000.00 + 20,000.50 = 35,000.50');
  });

  it('a combined cheque still needs every requisition signed', () => {
    const a = makeCheque(co);
    const b = makeCheque(co, { req: { signature: { status: 'not_signed' } } });
    const store = combineCheques(makeStore([co], [a, b]), ctxFor(operator), a.id, b.id);
    expect(kinds(createIssueChecker(store)(store.cheques[0]))).toEqual(['unsigned']);
  });

  it('an override on one requisition does not cover another combined with it later', () => {
    const released = makeCheque(co, { req: { signature: { status: 'not_signed' } } });
    const extra = makeCheque(co, { amountCents: 900_000, req: { signature: { status: 'not_signed' } } });
    let store = addOverride(makeStore([co], [released, extra]), ctxFor(supervisor), released.id, 'unsigned', 'Approved by phone', 'Operator');
    store = combineCheques(store, ctxFor(operator), released.id, extra.id);
    const combined = store.cheques[0];
    expect(combined.requisitions).toHaveLength(2);
    expect(isSigned(combined)).toBe(false);
    expect(kinds(createIssueChecker(store)(combined))).toEqual(['unsigned']);
    expect(() => assertPrintable(store, ctxFor(operator), [combined.id])).toThrow(StoreError);
  });

  it('a double-payment release does not survive a change of amount', () => {
    const first = makeCheque(co, { status: 'printed', chequeNumber: '000100' });
    const again = makeCheque(co, { chequeNumber: '000101' });
    let store = addOverride(makeStore([co], [first, again]), ctxFor(supervisor), again.id, 'duplicate_payment', 'Two separate invoices', 'Operator');
    expect(createIssueChecker(store)(store.cheques[1])).toEqual([]);
    store = editCheque(store, ctxFor(supervisor), again.id, { payee: again.payee, date: again.date, amountCents: 100, chequeNumber: '000101' });
    expect(store.cheques[1].overrides).toEqual([]);
  });

  it('refuses to combine different payees', () => {
    const a = makeCheque(co, { payee: 'Paul Angalushe' });
    const b = makeCheque(co, { payee: 'Someone Else' });
    expect(() => combineCheques(makeStore([co], [a, b]), ctxFor(operator), a.id, b.id)).toThrow('payees differ');
  });

  it('discarding one clears the other', () => {
    const a = makeCheque(co, { payee: 'A' });
    const b = makeCheque(co, { payee: 'B' });
    const store = cancelCheque(makeStore([co], [a, b]), ctxFor(operator), a.id, 'Replaced by corrected requisition');
    expect(createIssueChecker(store)(store.cheques[1])).toEqual([]);
    expect(store.cheques[0]).toMatchObject({ status: 'cancelled', statusNote: 'Replaced by corrected requisition' });
  });
});

describe('printing and the register', () => {
  const co = makeCompany('Alpha Ltd');

  it('will not print a held cheque, or two companies at once', () => {
    const other = makeCompany('Beta Ltd');
    const ok = makeCheque(co);
    const held = makeCheque(co, { chequeNumber: '000124', payee: 'B', req: { signature: { status: 'not_signed' } } });
    const elsewhere = makeCheque(other, { payee: 'C' });
    const store = makeStore([co, other], [ok, held, elsewhere]);
    const ctx = ctxFor(operator);
    expect(assertPrintable(store, ctx, [ok.id])).toHaveLength(1);
    expect(() => assertPrintable(store, ctx, [ok.id, held.id])).toThrow('not signed');
    expect(() => assertPrintable(store, ctx, [ok.id, elsewhere.id])).toThrow('one company at a time');
    expect(() => assertPrintable(store, ctx, [])).toThrow(StoreError);
  });

  it('records printed, spoiled and not-printed leaves', () => {
    const a = makeCheque(co, { chequeNumber: '000001', payee: 'A' });
    const b = makeCheque(co, { chequeNumber: '000002', payee: 'B' });
    const c = makeCheque(co, { chequeNumber: '000003', payee: 'C' });
    const store = recordPrintResults(makeStore([co], [a, b, c]), ctxFor(operator), [
      { id: a.id, outcome: 'printed' },
      { id: b.id, outcome: 'spoiled', note: 'Paper jam' },
      { id: c.id, outcome: 'not_printed' },
    ]);
    expect(store.cheques.map((x) => x.status)).toEqual(['printed', 'spoiled', 'pending']);
    expect(store.cheques[0]).toMatchObject({ printedByName: 'Operator', printedAt: '2026-06-05T09:00:00.000Z' });
    expect(store.cheques[1].statusNote).toBe('Paper jam');
    expect(store.audit.map((e) => e.action)).toEqual(['Printed', 'Spoiled', 'Did not print']);
  });

  it('holds cheques that went to the printer until the result is recorded', () => {
    const a = makeCheque(co, { chequeNumber: '000001', payee: 'A' });
    const b = makeCheque(co, { chequeNumber: '000002', payee: 'B' });
    let store = markSentToPrinter(makeStore([co], [a, b]), ctxFor(operator), [a.id, b.id]);
    const check = createIssueChecker(store);
    expect(kinds(check(store.cheques[0]))).toEqual(['print_unconfirmed']);
    expect(buildQueue(store, (c) => check(c).length === 0)).toEqual([]);

    const edit = { payee: 'A', date: '2026-06-05', amountCents: 100, chequeNumber: '1' };
    expect(() => assertPrintable(store, ctxFor(operator), [a.id])).toThrow('never recorded');
    expect(() => cancelCheque(store, ctxFor(admin), a.id, 'x')).toThrow('printer');
    expect(() => editCheque(store, ctxFor(admin), a.id, edit)).toThrow('printer');
    expect(() => deleteCompany(store, ctxFor(admin), co.id)).toThrow('cannot be deleted');

    store = recordPrintResults(store, ctxFor(operator), [
      { id: a.id, outcome: 'printed' },
      { id: b.id, outcome: 'not_printed' },
    ]);
    expect(store.cheques.map((c) => [c.status, c.printSentAt])).toEqual([
      ['printed', undefined],
      ['pending', undefined],
    ]);
    expect(createIssueChecker(store)(store.cheques[1])).toEqual([]);
  });

  it('a print that never started leaves the queue as it was', () => {
    const a = makeCheque(co);
    const sent = markSentToPrinter(makeStore([co], [a]), ctxFor(operator), [a.id]);
    const store = clearSentToPrinter(sent, ctxFor(operator), [a.id], 'Printing was cancelled.');
    expect(store.cheques[0].printSentAt).toBeUndefined();
    expect(createIssueChecker(store)(store.cheques[0])).toEqual([]);
    expect(store.audit.map((e) => e.action)).toEqual(['Sent to printer', 'Print did not start']);
  });

  it('a printed cheque cannot be printed, edited or discarded again', () => {
    const a = makeCheque(co);
    const store = recordPrintResults(makeStore([co], [a]), ctxFor(operator), [{ id: a.id, outcome: 'printed' }]);
    expect(() => recordPrintResults(store, ctxFor(operator), [{ id: a.id, outcome: 'printed' }])).toThrow(StoreError);
    expect(() => cancelCheque(store, ctxFor(admin), a.id, 'x')).toThrow(StoreError);
    expect(() => assertPrintable(store, ctxFor(operator), [a.id])).toThrow(StoreError);
  });

  it('spoiled after the fact keeps the number used; undo needs an administrator', () => {
    const a = makeCheque(co);
    let store = recordPrintResults(makeStore([co], [a]), ctxFor(operator), [{ id: a.id, outcome: 'printed' }]);
    expect(() => markSpoiled(store, ctxFor(operator), a.id, 'Torn')).toThrow(StoreError);

    const spoiled = markSpoiled(store, ctxFor(supervisor), a.id, 'Torn by the bank teller');
    expect(spoiled.cheques[0].status).toBe('spoiled');

    store = revertPrinted(store, ctxFor(admin), a.id, 'Printer was out of paper');
    expect(store.cheques[0].status).toBe('pending');
    expect(store.cheques[0].printedAt).toBeUndefined();
  });

  it('exports a spreadsheet that is safe to open in Excel', () => {
    const a = makeCheque(co, { payee: '=HYPERLINK("http://evil")', status: 'printed', printedAt: '2026-06-05T09:00:00.000Z', printedByName: 'Operator' });
    const b = makeCheque(co, { chequeNumber: '000124', payee: 'Smith, John "JJ"' });
    const csv = registerCsv(makeStore([co], [b, a]));
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].startsWith('Status,Company,Cheque No')).toBe(true);
    expect(lines[1]).toContain('"=""000123"""');
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(lines[1]).toContain('58,000.00');
    expect(lines[2]).toContain('"Smith, John ""JJ"""');
  });

  it('exports the activity log', () => {
    const a = makeCheque(co);
    const store = recordPrintResults(makeStore([co], [a]), ctxFor(operator), [{ id: a.id, outcome: 'printed' }]);
    expect(activityCsv(store)).toContain(`${formatTimestamp('2026-06-05T09:00:00.000Z')},Operator,Printed,`);
  });
});

describe('companies', () => {
  it('two companies cannot share a name', () => {
    const a = makeCompany('Alpha Ltd');
    const b = makeCompany('Beta Ltd', { aliases: ['Alpha Limited'] });
    expect(() => saveCompany(makeStore([a]), ctxFor(admin), b)).toThrow('already used by Alpha Ltd');
  });

  it('moving the signature box re-checks waiting requisitions', () => {
    const co = makeCompany('Alpha Ltd');
    const waiting = makeCheque(co);
    const printed = makeCheque(co, { status: 'printed', chequeNumber: '000200', payee: 'B' });
    const moved = { ...co, signatureZones: { requisition_voucher: [{ ...co.signatureZones.requisition_voucher![0], x: 0.1 }] } };
    const store = saveCompany(makeStore([co], [waiting, printed]), ctxFor(admin), moved);
    expect(store.cheques[0].requisitions[0].signature.status).toBe('unchecked');
    expect(store.cheques[1].requisitions[0].signature.status).toBe('signed');
  });

  it('assigning a company remembers the name and picks up its other requisitions', () => {
    const co = makeCompany('Alpha Ltd');
    const a = makeCheque(null, { companyRaw: 'ALPHA TRADING', payee: 'A' });
    const b = makeCheque(null, { companyRaw: 'Alpha Trading.', payee: 'B', chequeNumber: '000124' });
    const c = makeCheque(null, { companyRaw: 'Unrelated', payee: 'C', chequeNumber: '000125' });
    const store = assignCompany(makeStore([co], [a, b, c]), ctxFor(supervisor), a.id, co.id);
    expect(store.cheques.map((x) => x.companyId)).toEqual([co.id, co.id, null]);
    expect(store.companies[0].aliases).toContain('ALPHA TRADING');
    expect(store.cheques[0].requisitions[0].signature.status).toBe('unchecked');
  });

  it('a company with register history cannot be deleted', () => {
    const co = makeCompany('Alpha Ltd');
    const printed = makeCheque(co, { status: 'printed' });
    expect(() => deleteCompany(makeStore([co], [printed]), ctxFor(admin), co.id)).toThrow('cannot be deleted');

    const waiting = makeCheque(co);
    const store = deleteCompany(makeStore([co], [waiting]), ctxFor(admin), co.id);
    expect(store.companies).toHaveLength(0);
    expect(store.cheques[0].companyId).toBeNull();
  });

  it('imports layouts, including ones saved by the old web version', () => {
    const existing = makeCompany('Alpha Ltd');
    const oldFormat = {
      id: 'old-1',
      name: 'Alpha Limited',
      aliases: ['Alpha Limited'],
      printerType: 'dot_matrix',
      printerOffsetX: 1,
      printerOffsetY: -1,
      template: { chequeWidth: 210, chequeHeight: 90, pageTopOffset: 0, fields: { payee: { x: 25, y: 30, width: 120, fontSize: 10, fontFamily: 'Courier New', fontWeight: 'normal', align: 'left' } } },
    };
    const result = importCompanyLayouts(makeStore([existing]), ctxFor(admin), [oldFormat, { name: 'Gamma Ltd' }, { nonsense: true }]);
    expect(result).toMatchObject({ added: 1, updated: 1, skipped: [] });
    const alpha = result.store.companies.find((c) => c.id === existing.id)!;
    expect(alpha.name).toBe('Alpha Ltd');
    expect(alpha.printerType).toBe('dot_matrix');
    expect(alpha.template.chequeWidth).toBe(210);
    expect(alpha.template.fields.payee).toMatchObject({ x: 25, y: 30, fontFamily: 'Courier New' });
    expect(alpha.template.fields.date.x).toBe(148);
    expect(result.store.companies.map((c) => c.name)).toContain('Gamma Ltd');
  });
});

describe('sharing the register between computers', () => {
  const co = makeCompany('Alpha Ltd');
  const printedThere = (overrides = {}) => makeCheque(co, { status: 'printed', printedAt: '2026-06-05T09:00:00.000Z', printedByName: 'Mary', ...overrides });

  it('only sends cheques that were printed or spoiled', () => {
    const store = makeStore([co], [printedThere({ chequeNumber: '000001' }), makeCheque(co, { chequeNumber: '000002', payee: 'B' }), makeCheque(co, { chequeNumber: '000003', payee: 'C', status: 'spoiled' })]);
    const share = shareRegister(store, 'Mary', '2026-06-05T17:00:00.000Z');
    expect(share.cheques.map((c) => c.chequeNumber)).toEqual(['000001', '000003']);
    expect(share.companies.map((c) => c.name)).toEqual(['Alpha Ltd']);
  });

  it('a number used on the other computer is blocked here', () => {
    const there = makeStore([co], [printedThere({ chequeNumber: '000050' })]);
    const share = JSON.parse(JSON.stringify(shareRegister(there, 'Mary', '2026-06-05T17:00:00.000Z')));

    // This computer set the company up separately, so its id differs; the name matches.
    const sameCompanyHere = makeCompany('ALPHA LIMITED');
    const waiting = makeCheque(sameCompanyHere, { chequeNumber: '50', payee: 'Someone Else', amountCents: 100_000 });
    const result = mergeRegister(makeStore([sameCompanyHere], [waiting]), ctxFor(supervisor), share);

    expect(result).toMatchObject({ added: 1, known: 0, companiesAdded: [], clashes: [] });
    const received = result.store.cheques.find((c) => c.chequeNumber === '000050')!;
    expect(received).toMatchObject({ status: 'printed', companyId: sameCompanyHere.id, receivedFrom: 'Mary, 05/06/2026' });
    const issues = createIssueChecker(result.store)(result.store.cheques[0]);
    expect(kinds(issues)).toEqual(['duplicate_number']);
    expect(issues[0].hard).toBe(true);
    expect(buildQueue(result.store, (c) => createIssueChecker(result.store)(c).length === 0)).toEqual([]);
    expect(result.store.audit[result.store.audit.length - 1].action).toBe('Received register');
  });

  it('taking the same file in twice changes nothing', () => {
    const share = JSON.parse(JSON.stringify(shareRegister(makeStore([co], [printedThere()]), 'Mary', '2026-06-05T17:00:00.000Z')));
    const once = mergeRegister(makeStore([co]), ctxFor(admin), share);
    const twice = mergeRegister(once.store, ctxFor(admin), share);
    expect(twice).toMatchObject({ added: 0, known: 1 });
    expect(twice.store.cheques).toHaveLength(1);
  });

  it('brings over a company this computer does not have, and reports a number used on both', () => {
    const other = makeCompany('Beta Ltd');
    const there = makeStore([co, other], [printedThere({ chequeNumber: '000007' }), makeCheque(other, { status: 'printed', chequeNumber: '000900', payee: 'Z' })]);
    const share = JSON.parse(JSON.stringify(shareRegister(there, 'Mary', '2026-06-05T17:00:00.000Z')));
    const usedHereToo = makeCheque(co, { status: 'printed', chequeNumber: '7', payee: 'A Different Payee', amountCents: 500 });
    const result = mergeRegister(makeStore([co], [usedHereToo]), ctxFor(supervisor), share);
    expect(result.companiesAdded).toEqual(['Beta Ltd']);
    expect(result.clashes).toEqual(['000007']);
    expect(result).toMatchObject({ added: 1, known: 1 });
    expect(result.store.cheques).toHaveLength(2);
  });

  it('operators cannot take a register in, and other files are refused', () => {
    const share = shareRegister(makeStore([co], [printedThere()]), 'Mary', '2026-06-05T17:00:00.000Z');
    expect(() => mergeRegister(makeStore([co]), ctxFor(operator), share)).toThrow(StoreError);
    expect(() => mergeRegister(makeStore([co]), ctxFor(admin), { version: 1, cheques: [] })).toThrow('not a register');
  });
});

describe('clearing the queue', () => {
  it('discards every cheque given and logs each one', () => {
    const co = makeCompany('Alpha Ltd');
    const a = makeCheque(co, { chequeNumber: '000001', payee: 'A' });
    const b = makeCheque(co, { chequeNumber: '000002', payee: 'B' });
    const store = cancelCheques(makeStore([co], [a, b]), ctxFor(operator), [a.id, b.id], 'Cleared from the print queue');
    expect(store.cheques.map((c) => c.status)).toEqual(['cancelled', 'cancelled']);
    expect(store.audit).toHaveLength(2);
    expect(checkFileHash(store, a.requisitions[0].fileHash)).toEqual({ known: false }); // can be dropped in again
  });
});

describe('signature boxes saved by an earlier version', () => {
  it('a single box per form becomes a list of one', () => {
    const old = { id: 'c1', name: 'Alpha Ltd', signatureZones: { payment_receipt: { page: 1, x: 0.1, y: 0.6, w: 0.3, h: 0.05, ignoreTypedText: true } } };
    const store = parseStore(JSON.stringify({ version: 1, companies: [old] }));
    expect(store.companies[0].signatureZones).toEqual({ payment_receipt: [{ page: 1, x: 0.1, y: 0.6, w: 0.3, h: 0.05, ignoreTypedText: true }] });
  });

  it('keeps the label a box is tied to', () => {
    const zone = { page: 1, x: 0.1, y: 0.6, w: 0.3, h: 0.05, ignoreTypedText: true, anchor: { text: 'Approved By', dx: 0.05, dy: -0.02 } };
    const store = parseStore(JSON.stringify({ version: 1, companies: [{ id: 'c1', name: 'Alpha Ltd', signatureZones: { payment_receipt: [zone] } }] }));
    expect(store.companies[0].signatureZones.payment_receipt![0].anchor).toEqual({ text: 'approved by', dx: 0.05, dy: -0.02 });
  });
});

describe('restoring a backup', () => {
  it('never makes a used cheque printable again', () => {
    const co = makeCompany('Alpha Ltd');
    const a = makeCheque(co, { chequeNumber: '000001', payee: 'A' });
    const b = makeCheque(co, { chequeNumber: '000002', payee: 'B' });
    const backup = makeStore([co], [a, b]); // taken while both were waiting

    const later = makeCheque(co, { chequeNumber: '000003', payee: 'C' });
    const now = recordPrintResults(makeStore([co], [a, b, later]), ctxFor(operator), [
      { id: a.id, outcome: 'printed' },
      { id: b.id, outcome: 'spoiled', note: 'Jam' },
      { id: later.id, outcome: 'printed' },
    ]);

    const restored = reconcileRestore(now, backup);
    expect(restored.cheques.map((c) => [c.chequeNumber, c.status])).toEqual([
      ['000001', 'printed'],
      ['000002', 'spoiled'],
      ['000003', 'printed'],
    ]);
    expect(buildQueue(restored, () => true)).toEqual([]);
  });
});

describe('data file', () => {
  it('survives a save and load unchanged', () => {
    const co = makeCompany('Alpha Ltd');
    const store = makeStore([co], [makeCheque(co)]);
    expect(parseStore(serializeStore(store))).toEqual(store);
  });

  it('rejects files that are not ours or are from a newer version', () => {
    expect(() => parseStore('not json')).toThrow(StoreError);
    expect(() => parseStore('[]')).toThrow(StoreError);
    expect(() => parseStore('{"hello":1}')).toThrow(StoreError);
    expect(() => parseStore('{"version":2}')).toThrow('newer version');
  });

  it('fills in anything missing', () => {
    const store = parseStore('{"version":1}');
    expect(store).toEqual(emptyStore());
  });
});
