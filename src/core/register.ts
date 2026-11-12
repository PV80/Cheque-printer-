// Spreadsheet exports of the cheque register and the activity log.

import { formatMoney } from './amount';
import { formatDate, formatTimestamp } from './dates';
import { compareChequeNumbers } from './queue';
import type { Cheque, Store } from './types';

function cell(value: string): string {
  // A cell starting with = + - @ would run as a formula in Excel; neutralise it.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Keeps leading zeros when the file is opened in Excel. Digits only. */
function numberCell(chequeNumber: string): string {
  return /^\d+$/.test(chequeNumber) ? `"=""${chequeNumber}"""` : cell(chequeNumber);
}

const stamp = formatTimestamp;

const STATUS_LABEL: Record<Cheque['status'], string> = {
  pending: 'Not printed',
  printed: 'Printed',
  spoiled: 'Spoiled',
  cancelled: 'Discarded',
};

export function signatureSummary(cheque: Cheque): string {
  const override = cheque.overrides.find((o) => o.kind === 'unsigned');
  if (override) return `Override by ${override.byName}: ${override.reason}`;
  if (cheque.requisitions.length === 0) return 'No requisition';
  if (cheque.requisitions.every((r) => r.signature.status === 'signed')) return 'Signed';
  if (cheque.requisitions.some((r) => r.signature.status === 'not_signed')) return 'Not signed';
  return 'Not checked';
}

function toCsv(rows: string[][]): string {
  // BOM so Excel reads names with accents correctly.
  return '﻿' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}

export function registerCsv(store: Store): string {
  const companyName = new Map(store.companies.map((c) => [c.id, c.name]));
  const nameOf = (c: Cheque) => (c.companyId && companyName.get(c.companyId)) || c.companyRaw || '';

  const sorted = [...store.cheques].sort(
    (a, b) => nameOf(a).localeCompare(nameOf(b)) || compareChequeNumbers(a.chequeNumber, b.chequeNumber)
  );

  const header = [
    'Status', 'Company', 'Cheque No', 'Cheque Date', 'Payee', 'Amount (KES)', 'Signature',
    'Requisition file(s)', 'Loaded', 'Loaded by', 'Printed', 'Printed by', 'Edited by hand', 'Note',
  ];

  const rows = sorted.map((c) => [
    cell(STATUS_LABEL[c.status]),
    cell(nameOf(c)),
    numberCell(c.chequeNumber),
    cell(formatDate(c.date)),
    cell(c.payee),
    cell(formatMoney(c.amountCents)),
    cell(signatureSummary(c)),
    cell(c.requisitions.map((r) => r.filename).join('; ')),
    cell(stamp(c.createdAt)),
    cell(c.requisitions[0]?.importedByName ?? ''),
    cell(stamp(c.printedAt)),
    cell(c.printedByName ?? ''),
    cell(c.edited ? 'Yes' : ''),
    cell([c.statusNote, c.receivedFrom ? `Received from ${c.receivedFrom}` : ''].filter(Boolean).join(' — ')),
  ]);

  return toCsv([header, ...rows]);
}

export function activityCsv(store: Store): string {
  const rows = store.audit.map((a) => [cell(stamp(a.at)), cell(a.userName), cell(a.action), cell(a.details)]);
  return toCsv([['When', 'User', 'Action', 'Details'], ...rows]);
}
