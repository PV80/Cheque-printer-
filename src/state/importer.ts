// What happens when a PDF is dropped on the app.

import { can } from '../core/auth';
import { matchCompany } from '../core/company';
import { formatTimestampDate } from '../core/dates';
import { createIssueChecker } from '../core/issues';
import { parseRequisition } from '../core/parser';
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
  // A payroll is looked at again: some of its salary slips may not be loaded yet.
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

    const { otherRequisitionPages, ...parsed } = parseRequisition(pages, { producedOn: await producedOn(pdf) });
    if (otherRequisitionPages.length > 0) {
      return {
        state: 'error',
        message: `This PDF holds more than one requisition (also on page ${otherRequisitionPages.join(', ')}). Save each one as its own PDF.`,
      };
    }

    const company = matchCompany(parsed.companyRaw, deps.getStore().companies);
    const zone = company?.signatureZones[parsed.documentType];
    let signature: SignatureResult = zone?.length ? await signatureResult(pdf, zone) : { status: 'unchecked' };

    await api.savePdf(fileHash, bytes);

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
    };
    const cheque = chequeFromRequisition(requisition, companyNow?.id ?? null, crypto.randomUUID(), now);

    let replaced = false;
    const ok = deps.run((store, ctx) => {
      const result = addCheque(store, ctx, cheque);
      replaced = result.replaced !== null;
      return result.store;
    });
    if (!ok) return { state: 'error', message: 'Could not load this requisition.' };

    const store = deps.getStore();
    const added = store.cheques.find((c) => c.id === cheque.id);
    const issues = added ? createIssueChecker(store, measureText)(added) : [];
    const label = `${companyNow?.name ?? (parsed.companyRaw || 'Unknown company')} — cheque ${parsed.chequeNumber || '(no number)'}`;

    if (issues.length > 0) return { state: 'held', message: `${label}. Held: ${issues[0].message}` };
    return {
      state: 'queued',
      message: replaced ? `${label}. Signed copy received — added to the print queue.` : `${label}. Signed — added to the print queue.`,
    };
  } finally {
    void pdf.destroy();
  }
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
