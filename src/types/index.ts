export type DocumentType = 'requisition_voucher' | 'payment_receipt' | 'unknown';
export type ChequeStatus = 'extracting' | 'needs_review' | 'ready' | 'printed' | 'error';

export interface ChequeData {
  id: string;
  filename: string;
  companyRaw: string;
  companyId: string | null;
  payee: string;
  date: string;           // DD/MM/YYYY
  amountFigures: number;
  amountWords: string;
  chequeNumber: string;
  documentType: DocumentType;
  status: ChequeStatus;
  errorMessage?: string;
}

export interface FieldPosition {
  x: number;       // mm from left of cheque
  y: number;       // mm from top of cheque
  width: number;   // mm
  fontSize: number;
  fontFamily: 'Arial' | 'Courier New' | 'Times New Roman';
  fontWeight: 'normal' | 'bold';
  align: 'left' | 'center' | 'right';
}

export interface ChequeTemplate {
  chequeWidth: number;       // mm — standard NCBA: 215
  chequeHeight: number;      // mm — standard NCBA: 85
  pageTopOffset: number;     // mm — shift from top of paper to top of cheque area
  fields: {
    date: FieldPosition;
    payee: FieldPosition;
    amountWords: FieldPosition;
    amountFigures: FieldPosition;
  };
}

export interface CompanyProfile {
  id: string;
  name: string;              // canonical display name
  aliases: string[];         // name variants that appear in PDFs
  bankAccount?: string;
  template: ChequeTemplate;
}

export type ActiveTab = 'upload' | 'batches' | 'print' | 'setup';

export interface BatchGroup {
  companyId: string | null;
  companyName: string;
  cheques: ChequeData[];
}
