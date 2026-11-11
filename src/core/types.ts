// Data model. Everything here is plain JSON so it can be saved to disk as-is.
// Amounts are integer cents. Cheque dates are ISO "YYYY-MM-DD". Timestamps are ISO-8601.

// ---- People -----------------------------------------------------------------

export type Role = 'admin' | 'supervisor' | 'operator';

export interface User {
  id: string;
  username: string; // lower-case, unique
  displayName: string;
  role: Role;
  salt: string;
  hash: string;
  active: boolean;
  createdAt: string;
}

// ---- Companies and cheque layouts --------------------------------------------

export type FontFamily = 'Arial' | 'Courier New' | 'Times New Roman';
export type FieldKey = 'date' | 'payee' | 'amountWords' | 'amountFigures';

export interface FieldPosition {
  x: number; // mm from left edge of cheque
  y: number; // mm from top edge of cheque (top of the first text line)
  width: number; // mm
  height?: number; // mm — for wrapped fields, the space available
  fontSize: number; // pt
  fontFamily: FontFamily;
  fontWeight: 'normal' | 'bold';
  align: 'left' | 'center' | 'right';
  wrap?: boolean;
  lineSpacing?: number; // mm between the tops of wrapped lines (match the ruled lines)
}

export interface ChequeTemplate {
  chequeWidth: number; // mm
  chequeHeight: number; // mm
  pageTopOffset: number; // mm from top of the sheet to the top of the cheque
  fields: Record<FieldKey, FieldPosition>;
}

export type PrinterType = 'laser' | 'dot_matrix';

/** Where the approver signs on this company's requisition, as fractions of the page. */
export interface SignatureZone {
  page: number; // 1-based
  x: number;
  y: number;
  w: number;
  h: number;
  ignoreTypedText: boolean;
}

export interface CompanyProfile {
  id: string;
  name: string;
  aliases: string[]; // name variants as they appear on requisitions (includes name)
  bankAccount?: string;
  printerType: PrinterType;
  printerName: string; // '' = show the system print dialog
  printerOffsetX: number; // mm
  printerOffsetY: number; // mm
  template: ChequeTemplate;
  signatureZone: SignatureZone | null;
  loadingNote: string; // shown to whoever loads the cheques, e.g. "Face up, top edge first"
}

// ---- Requisitions and cheques -------------------------------------------------

export type DocumentType = 'requisition_voucher' | 'payment_receipt' | 'unknown';

export interface SignatureResult {
  status: 'signed' | 'not_signed' | 'unchecked';
  inkMm2?: number;
  widthMm?: number;
  heightMm?: number;
  checkedAt?: string;
}

/** One dropped PDF, with what was read from it. Never edited after import. */
export interface Requisition {
  id: string;
  filename: string;
  fileHash: string; // sha-256 of the PDF, also the archive file name
  importedAt: string;
  importedById: string;
  importedByName: string;
  documentType: DocumentType;
  companyRaw: string;
  payee: string;
  dateRaw: string;
  date: string; // ISO or ''
  amountCents: number; // 0 when not found
  amountWordsRaw: string;
  wordsCents: number | null; // amount the words spell out, null if absent/unreadable
  chequeNumber: string;
  signature: SignatureResult;
}

export type OverrideKind = 'unsigned' | 'duplicate_payment';

export interface Override {
  kind: OverrideKind;
  byUserId: string;
  byName: string;
  requestedByName: string;
  reason: string;
  at: string;
}

export type ChequeStatus = 'pending' | 'printed' | 'spoiled' | 'cancelled';

/** One physical cheque leaf. Usually one requisition, occasionally several combined. */
export interface Cheque {
  id: string;
  companyId: string | null;
  companyRaw: string;
  chequeNumber: string;
  payee: string;
  date: string; // ISO or ''
  amountCents: number;
  requisitions: Requisition[];
  status: ChequeStatus;
  statusNote: string;
  edited: boolean; // details changed by hand after import
  amountConfirmed: boolean; // a supervisor confirmed the amount after a words/figures mismatch
  overrides: Override[];
  createdAt: string;
  /** Handed to the printer, but what came out has not been recorded yet. */
  printSentAt?: string;
  printedAt?: string;
  printedByName?: string;
}

// ---- Log, settings, store -----------------------------------------------------

export interface AuditEntry {
  id: string;
  at: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
  chequeId?: string;
}

export interface Settings {
  autoLockMinutes: number; // 0 = never
}

export interface Store {
  version: 1;
  users: User[];
  companies: CompanyProfile[];
  cheques: Cheque[];
  audit: AuditEntry[];
  settings: Settings;
}
