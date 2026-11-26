// What happens when a PDF is dropped on the app.

import { can } from '../core/auth';
import { matchCompany } from '../core/company';
import { formatTimestampDate } from '../core/dates';
import { createIssueChecker, type Issue } from '../core/issues';
import { parseRequisition, requisitionStartPages, type ParsedRequisition } from '../core/parser';
import { parsePayroll, type PayrollSlip } from '../core/payroll';
import { addCheque, addPayroll, chequeFromRequisition, checkFileHash, describeCheque, loadedSlips, type Ctx } from '../core/store';
import type { Cheque, PageRange, Requisition, SignatureResult, SignatureZone, Store, User } from '../core/types';

import { api } from '../platform/api';
import { measureText } from '../platform/measure';
import { checkSignatureBoxes, extractPages, looksLikePdf, openPdf, producedOn, sha256Hex, type PdfDocument } from '../platform/pdf';

export type ImportState = 'working' | 'queued' | 'held' | 'skipped' | 'error';

export interface ImportOutcome {
  state: ImportState;
  message: string;
}

/** A payroll PDF waiting for someone to say which cheques to make from it. */
export interface PayrollRequest {
  filename: string;
  period: string;
  companyRaw: string;
  /** The company the slips name, if it is known; otherwise the only company there is. */
  suggestedCompanyId: string | null;
  slips: (PayrollSlip & { /** Set when a cheque was already made from this slip. */ loadedAs?: string })[];
}

export interface PayrollAnswer {
  companyId: string;
  date: string; // ISO
  /** The cheque number for each slip to load, by the page the slip starts on. */
  numbers: Record<number, string>;
}

export interface ImportDeps {
  user: User;
  getStore: () => Store;
  run: (action: (store: Store, ctx: Ctx) => Store) => boolean;
  /** Shows the payroll window; resolves with null if it is cancelled. */
  askPayroll: (request: PayrollRequest) => Promise<PayrollAnswer | null>;
}

const MAX_PDF_BYTES = 50 * 1024 * 1024;

export async function signatureResult(pdf: PdfDocument, zones: SignatureZone[], within?: PageRange): Promise<SignatureResult> {
  const ink = await checkSignatureBoxes(pdf, zones, within);
  return {
    status: ink.signed ? 'signed' : 'not_signed',
    inkMm2: ink.inkMm2,
    widthMm: ink.widthMm,
    heightMm: ink.heightMm,
    checkedAt: new Date().toISOString(),
  };
}

export async function importPdfFile(file: File, deps: ImportDeps): Promise<ImportOutcome> {
  if (file.size === 0) return { state: 'error', message: 'The file is empty.' };
  if (file.size > MAX_PDF_BYTES) return { state: 'error', message: 'The file is too large (over 50 MB).' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) return { state: 'error', message: 'Not a PDF file.' };

  const fileHash = await sha256Hex(bytes);
  const seen = checkFileHash(deps.getStore(), fileHash);
  // A PDF holding several requisitions is looked at again: some may not be loaded yet.
  if (seen.known && loadedSlips(deps.getStore(), fileHash).size === 0) {
    const n = seen.cheque.chequeNumber || '(no number)';
    if (seen.reason === 'already_loaded') return { state: 'skipped', message: `Already loaded (cheque ${n}).` };
    if (seen.reason === 'already_printed') {
      const when = seen.cheque.printedAt ? ` on ${formatTimestampDate(seen.cheque.printedAt)}` : '';
      return { state: 'skipped', message: `Already printed as cheque ${n}${when}. Not loaded again.` };
    }
    return {
      state: 'skipped',
      message: `Cheque ${n} from this requisition was marked spoiled. Issue a new requisition with a new cheque number.`,
    };
  }

  let pdf: PdfDocument;
  try {
    pdf = await openPdf(bytes);
  } catch {
    return { state: 'error', message: 'Could not open this PDF. It may be damaged or password-protected.' };
  }

  try {
    const pages = await extractPages(pdf);
    if (pages.every((lines) => lines.length === 0)) {
      return {
        state: 'error',
        message: 'No readable text — this looks like a scan or photo. Use the original PDF, signed on screen.',
      };
    }

    const slips = parsePayroll(pages);
    if (slips.length > 0) return await importPayroll({ file, bytes, fileHash, pdf, slips }, deps);

    const produced = await producedOn(pdf);

    // Several requisitions in one PDF, each complete with its own cheque number
    // (a month's salary vouchers, say): each is loaded as if it were its own file.
    const starts = requisitionStartPages(pages);
    if (starts.length > 1 || (starts.length === 1 && starts[0] > 1)) {
      return await importBatch({ file, bytes, fileHash, pdf, pages, starts, produced }, deps);
    }

    const parsed = readRequisition(pages, produced);
    await api.savePdf(fileHash, bytes);
    const result = await loadRequisition({ file, fileHash, pdf, parsed }, deps);
    if (!result) return { state: 'error', message: 'Could not load this requisition.' };
    if (result.issues.length > 0) return { state: 'held', message: `${result.label}. Held: ${result.issues[0].message}` };
    return {
      state: 'queued',
      message: result.replaced ? `${result.label}. Signed copy received — added to the print queue.` : `${result.label}. Signed — added to the print queue.`,
    };
  } finally {
    void pdf.destroy();
  }
}

type ParsedOne = Omit<ParsedRequisition, 'otherRequisitionPages'>;

function readRequisition(pages: string[][], produced: string | undefined): ParsedOne {
  const { otherRequisitionPages, ...parsed } = parseRequisition(pages, { producedOn: produced });
  void otherRequisitionPages;
  return parsed;
}

/**
 * Checks one requisition's signature and adds its cheque. `within` is the part
 * of the PDF it occupies, when the PDF holds several. Null if it was refused.
 */
async function loadRequisition(
  input: { file: File; fileHash: string; pdf: PdfDocument; parsed: ParsedOne; within?: PageRange },
  deps: ImportDeps
): Promise<{ label: string; issues: Issue[]; replaced: boolean } | null> {
  const { file, fileHash, pdf, parsed, within } = input;
  const company = matchCompany(parsed.companyRaw, deps.getStore().companies);
  const zone = company?.signatureZones[parsed.documentType];
  let signature: SignatureResult = zone?.length ? await signatureResult(pdf, zone, within) : { status: 'unchecked' };

  // If the company or its signature box changed while this file was being read, check again later.
  const companyNow = matchCompany(parsed.companyRaw, deps.getStore().companies);
  if (companyNow?.id !== company?.id || JSON.stringify(companyNow?.signatureZones[parsed.documentType]) !== JSON.stringify(zone)) {
    signature = { status: 'unchecked' };
  }

  const now = new Date().toISOString();
  const requisition: Requisition = {
    id: crypto.randomUUID(),
    filename: file.name,
    fileHash,
    importedAt: now,
    importedById: deps.user.id,
    importedByName: deps.user.displayName,
    ...parsed,
    signature,
    ...(within ? { pages: within } : {}),
  };
  const cheque = chequeFromRequisition(requisition, companyNow?.id ?? null, crypto.randomUUID(), now);

  let replaced = false;
  const ok = deps.run((store, ctx) => {
    const result = addCheque(store, ctx, cheque);
    replaced = result.replaced !== null;
    return result.store;
  });
  if (!ok) return null;

  const store = deps.getStore();
  const added = store.cheques.find((c) => c.id === cheque.id);
  return {
    label: `${companyNow?.name ?? (parsed.companyRaw || 'Unknown company')} — cheque ${parsed.chequeNumber || '(no number)'}`,
    issues: added ? createIssueChecker(store, measureText)(added) : [],
    replaced,
  };
}

/**
 * One PDF holding several requisitions. Each begins on a page with the form's
 * heading and runs to the page before the next; the pages after its first are
 * its supporting papers and are not read. Every rule applies to each one
 * exactly as if it had been dropped as its own file.
 */
async function importBatch(
  input: { file: File; bytes: Uint8Array; fileHash: string; pdf: PdfDocument; pages: string[][]; starts: number[]; produced: string | undefined },
  deps: ImportDeps
): Promise<ImportOutcome> {
  const { file, bytes, fileHash, pdf, pages, starts, produced } = input;
  const ranges: PageRange[] = starts.map((from, k) => ({ from, to: k + 1 < starts.length ? starts[k + 1] - 1 : pages.length }));
  const already = loadedSlips(deps.getStore(), fileHash);
  const count = `${ranges.length} ${ranges.length === 1 ? 'requisition' : 'requisitions'}`;
  if (ranges.every((range) => already.has(range.from))) {
    return { state: 'skipped', message: `Already loaded: this PDF (${count}).` };
  }

  await api.savePdf(fileHash, bytes);

  let queued = 0;
  let refused = 0;
  const numbers: string[] = [];
  const held: string[] = [];
  for (const within of ranges) {
    if (already.has(within.from)) continue;
    const parsed = readRequisition(pages.slice(within.from - 1, within.to), produced);
    const result = await loadRequisition({ file, fileHash, pdf, parsed, within }, deps);
    if (!result) {
      refused++;
      continue;
    }
    if (parsed.chequeNumber) numbers.push(parsed.chequeNumber);
    if (result.issues.length > 0) held.push(`cheque ${parsed.chequeNumber || '(no number)'} — ${result.issues[0].message}`);
    else queued++;
  }

  const span = numbers.length > 1 ? ` (cheques ${numbers[0]} to ${numbers[numbers.length - 1]})` : numbers.length === 1 ? ` (cheque ${numbers[0]})` : '';
  const parts = [
    queued > 0 ? `${queued} added to the print queue` : '',
    held.length > 0 ? `${held.length} held` : '',
    already.size > 0 ? `${ranges.filter((r) => already.has(r.from)).length} already loaded` : '',
    refused > 0 ? `${refused} could not be loaded` : '',
  ].filter(Boolean);
  const message = `${count} in this PDF${span}: ${parts.join(', ')}.${held.length > 0 ? ` First held: ${held[0]}` : ''}`;
  return { state: held.length > 0 ? 'held' : queued > 0 ? 'queued' : 'error', message };
}

/** One PDF holding a salary slip for each employee: one cheque is made per slip. */
async function importPayroll(
  input: { file: File; bytes: Uint8Array; fileHash: string; pdf: PdfDocument; slips: PayrollSlip[] },
  deps: ImportDeps
): Promise<ImportOutcome> {
  const { file, bytes, fileHash, pdf, slips } = input;
  const count = `${slips.length} salary ${slips.length === 1 ? 'slip' : 'slips'}`;
  if (!can(deps.user, 'edit_cheque')) {
    return {
      state: 'error',
      message: `This is a payroll with ${count}. A supervisor or administrator must load it, because each cheque has to be given its number.`,
    };
  }

  const loaded = loadedSlips(deps.getStore(), fileHash);
  if (!slips.some((slip) => slip.amountCents > 0)) {
    return { state: 'error', message: `This payroll has ${count}, but none shows an amount to pay.` };
  }
  if (slips.every((slip) => loaded.has(slip.pages.from) || slip.amountCents <= 0)) {
    return { state: 'skipped', message: `Already loaded: this payroll (${loaded.size} ${loaded.size === 1 ? 'cheque' : 'cheques'}).` };
  }

  const companies = deps.getStore().companies;
  const suggested = matchCompany(slips[0].companyRaw, companies) ?? (companies.length === 1 ? companies[0] : null);
  const answer = await deps.askPayroll({
    filename: file.name,
    period: slips[0].period,
    companyRaw: slips[0].companyRaw,
    suggestedCompanyId: suggested?.id ?? null,
    slips: slips.map((slip) => {
      const cheque = loaded.get(slip.pages.from);
      return cheque ? { ...slip, loadedAs: describeCheque(cheque) } : slip;
    }),
  });
  if (!answer) return { state: 'skipped', message: `Payroll with ${count}: cancelled, nothing was loaded.` };

  const company = deps.getStore().companies.find((c) => c.id === answer.companyId);
  if (!company) return { state: 'error', message: 'That company no longer exists.' };
  const zones = company.signatureZones.salary_slip;

  await api.savePdf(fileHash, bytes);

  const now = new Date().toISOString();
  const cheques: Cheque[] = [];
  for (const slip of slips) {
    const chequeNumber = answer.numbers[slip.pages.from];
    if (chequeNumber === undefined) continue;
    const requisition: Requisition = {
      id: crypto.randomUUID(),
      filename: file.name,
      fileHash,
      importedAt: now,
      importedById: deps.user.id,
      importedByName: deps.user.displayName,
      documentType: 'salary_slip',
      companyRaw: slip.companyRaw,
      payee: slip.payee,
      dateRaw: slip.period,
      date: '',
      amountCents: slip.amountCents,
      amountWordsRaw: '',
      wordsCents: null,
      chequeNumber: slip.chequeNumber,
      reviewNotes: slip.reviewNotes,
      // Each slip is signed in its own right: only its own pages are looked at.
      signature: zones?.length ? await signatureResult(pdf, zones, slip.pages) : { status: 'unchecked' },
      pages: slip.pages,
    };
    // The number and the date come from the person loading the payroll, not from the slip.
    cheques.push({ ...chequeFromRequisition(requisition, company.id, crypto.randomUUID(), now), chequeNumber, date: answer.date });
  }

  // If the signature box changed while the slips were being read, check them again later.
  const zonesNow = deps.getStore().companies.find((c) => c.id === company.id)?.signatureZones.salary_slip;
  if (JSON.stringify(zonesNow) !== JSON.stringify(zones)) {
    for (const cheque of cheques) cheque.requisitions[0].signature = { status: 'unchecked' };
  }

  if (!deps.run((store, ctx) => addPayroll(store, ctx, cheques))) {
    return { state: 'error', message: 'The payroll was not loaded. Drop it again to correct the cheque numbers.' };
  }

  const store = deps.getStore();
  const check = createIssueChecker(store, measureText);
  const held = cheques.filter((cheque) => {
    const added = store.cheques.find((c) => c.id === cheque.id);
    return added !== undefined && check(added).length > 0;
  });
  const numbers = cheques.map((c) => c.chequeNumber);
  const label = `${company.name} — payroll ${slips[0].period}: ${cheques.length} ${cheques.length === 1 ? 'cheque' : 'cheques'} (${numbers[0]}${numbers.length > 1 ? ` to ${numbers[numbers.length - 1]}` : ''})`;
  if (held.length === 0) return { state: 'queued', message: `${label}. All signed — added to the print queue.` };

  const firstHeld = store.cheques.find((c) => c.id === held[0].id)!;
  return {
    state: 'held',
    message: `${label}. ${cheques.length - held.length} in the print queue, ${held.length} held: ${check(firstHeld)[0].message}`,
  };
}
