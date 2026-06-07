import { ChequeData, DocumentType } from '../types';
import { amountToWords, parseAmountString } from './amountToWords';
import { v4 as uuidv4 } from 'uuid';

function detectDocumentType(text: string): DocumentType {
  if (/CHEQUE REQUISITION VOUCHER/i.test(text)) return 'requisition_voucher';
  if (/Payment Receipt/i.test(text) || /Payment Amount/i.test(text)) return 'payment_receipt';
  return 'unknown';
}

function parseRequisitionVoucher(pages: string[], _filename: string): Partial<ChequeData> {
  // Use page 1 for the requisition form
  const text = pages[0] || '';

  // Company: first capitalised block before "CHEQUE REQUISITION"
  const companyMatch = text.match(/([A-Z][A-Z\s&.]+(?:LTD|LIMITED|INVESTMENTS|GROUP|COMPANY|CO)\.?)/i);
  const companyRaw = companyMatch ? companyMatch[1].trim() : 'Unknown Company';

  // Date of Payment (preferred) or Date of Requisitioning
  const dateMatch =
    text.match(/Date of Payment[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i) ||
    text.match(/Date of Requisitioning[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i) ||
    text.match(/DATE[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i);
  const date = dateMatch ? normaliseDate(dateMatch[1]) : '';

  // PAYEE, CHQ, AMOUNT on one line
  const payeeLine = text.match(/PAYEE[:\s]+(.+?)\s+CHQ[:\s]*(\d+)\s+AMOUNT[:\s]*([\d,]+[\/=]+)/i);

  let payee = '';
  let chequeNumber = '';
  let amountFigures = 0;

  if (payeeLine) {
    payee = payeeLine[1].trim();
    chequeNumber = payeeLine[2].trim();
    amountFigures = parseAmountString(payeeLine[3]);
  } else {
    // Fallback: parse fields individually
    const p = text.match(/PAYEE[:\s]+(.+?)(?=\s{2,}|CHQ|AMOUNT|$)/i);
    if (p) payee = p[1].trim();
    const c = text.match(/CHQ[:\s]*(\d+)/i);
    if (c) chequeNumber = c[1];
    const a = text.match(/AMOUNT[:\s]*([\d,]+[\/=]+)/i);
    if (a) amountFigures = parseAmountString(a[1]);
  }

  // Amount in words from the SHILLINGS field
  const wordsMatch = text.match(/SHILLINGS[:\s]+(.+?)(?=\s{2,}|Details|$)/i);
  const amountWords = wordsMatch
    ? capitalise(wordsMatch[1].trim())
    : amountToWords(amountFigures);

  return { companyRaw, payee, date, amountFigures, amountWords, chequeNumber, documentType: 'requisition_voucher' };
}

function parsePaymentReceipt(pages: string[], _filename: string): Partial<ChequeData> {
  const text = pages[0] || '';

  // Company from bank field "NCBA Bank -CompanyName" or footer
  const bankMatch = text.match(/Bank[:\s]+NCBA\s+Bank\s*[-–]\s*(.+?)(?=\s{2,}|$)/i);
  let companyRaw = bankMatch ? bankMatch[1].trim() : '';
  if (!companyRaw) {
    const companyMatch = text.match(/([A-Z][A-Z\s&.]+(?:LTD|LIMITED|INVESTMENTS|GROUP|COMPANY|CO)\.?)/i);
    companyRaw = companyMatch ? companyMatch[1].trim() : 'Unknown Company';
  }

  // Payment date
  const dateMatch = text.match(/Payment Date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i);
  const date = dateMatch ? normaliseDate(dateMatch[1]) : '';

  // Vendor / Payee
  const vendorMatch = text.match(/Vendor[:\s]+(.+?)(?=\s{2,}|Payment|$)/i);
  const payee = vendorMatch ? vendorMatch[1].trim() : '';

  // Payment amount
  const amountMatch = text.match(/Payment Amount[:\s]+KSh\s*([\d,]+\.?\d*)/i);
  const amountFigures = amountMatch ? parseAmountString(amountMatch[1]) : 0;

  // Cheque number embedded in reference text
  const chequeMatch =
    text.match(/Cheque\s*number[:\s]*(\d+)/i) ||
    text.match(/cheque[:\s]*(\d+)/i) ||
    text.match(/CHQ[:\s]*(\d+)/i);
  const chequeNumber = chequeMatch ? chequeMatch[1] : '';

  const amountWords = amountToWords(amountFigures);

  return { companyRaw, payee, date, amountFigures, amountWords, chequeNumber, documentType: 'payment_receipt' };
}

function normaliseDate(raw: string): string {
  // Ensure DD/MM/YYYY format
  return raw.replace(/-/g, '/');
}

function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function parsePdfPages(pages: string[], _filename: string): ChequeData {
  const allText = pages.join(' ');
  const docType = detectDocumentType(allText);

  let partial: Partial<ChequeData> = {};

  if (docType === 'requisition_voucher') {
    partial = parseRequisitionVoucher(pages, _filename);
  } else if (docType === 'payment_receipt') {
    partial = parsePaymentReceipt(pages, _filename);
  } else {
    partial = parseRequisitionVoucher(pages, _filename);
    partial.documentType = 'unknown';
  }

  const hasAllFields =
    !!partial.payee &&
    !!partial.date &&
    (partial.amountFigures ?? 0) > 0 &&
    !!partial.chequeNumber;

  return {
    id: uuidv4(),
    filename: _filename,
    companyRaw: partial.companyRaw || 'Unknown Company',
    companyId: null,
    payee: partial.payee || '',
    date: partial.date || '',
    amountFigures: partial.amountFigures || 0,
    amountWords: partial.amountWords || '',
    chequeNumber: partial.chequeNumber || '',
    documentType: partial.documentType || 'unknown',
    status: hasAllFields ? 'ready' : 'needs_review',
  };
}
