// What happens when a PDF is dropped on the app.

import { matchCompany } from '../core/company';
import { formatTimestampDate } from '../core/dates';
import { createIssueChecker } from '../core/issues';
import { parseRequisition } from '../core/parser';
import { addCheque, chequeFromRequisition, checkFileHash, type Ctx } from '../core/store';
import type { Requisition, SignatureResult, SignatureZone, Store, User } from '../core/types';
import { api } from '../platform/api';
import { measureText } from '../platform/measure';
import { checkSignature, extractPages, looksLikePdf, openPdf, sha256Hex, type PdfDocument } from '../platform/pdf';

export type ImportState = 'working' | 'queued' | 'held' | 'skipped' | 'error';

export interface ImportOutcome {
  state: ImportState;
  message: string;
}

export interface ImportDeps {
  user: User;
  getStore: () => Store;
  run: (action: (store: Store, ctx: Ctx) => Store) => boolean;
}

const MAX_PDF_BYTES = 50 * 1024 * 1024;

export async function signatureResult(pdf: PdfDocument, zone: SignatureZone): Promise<SignatureResult> {
  const ink = await checkSignature(pdf, zone);
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
  if (seen.known) {
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

    const parsed = parseRequisition(pages);
    const company = matchCompany(parsed.companyRaw, deps.getStore().companies);
    const signature: SignatureResult = company?.signatureZone
      ? await signatureResult(pdf, company.signatureZone)
      : { status: 'unchecked' };

    await api.savePdf(fileHash, bytes);

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
    const cheque = chequeFromRequisition(requisition, company?.id ?? null, crypto.randomUUID(), now);

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
    const label = `${company?.name ?? (parsed.companyRaw || 'Unknown company')} — cheque ${parsed.chequeNumber || '(no number)'}`;

    if (issues.length > 0) return { state: 'held', message: `${label}. Held: ${issues[0].message}` };
    return {
      state: 'queued',
      message: replaced ? `${label}. Signed copy received — added to the print queue.` : `${label}. Signed — added to the print queue.`,
    };
  } finally {
    void pdf.destroy();
  }
}
