import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { CheckCircle, FileUp, Trash2, XCircle } from 'lucide-react';
import { FORM_LABELS } from '../core/company';
import { formTypeOf } from '../core/payroll';
import { SIGNATURE_MINIMUM, type InkAnalysis } from '../core/signature';
import { saveCompany } from '../core/store';
import type { DocumentType, SignatureZone } from '../core/types';
import { api } from '../platform/api';
import {
  checkSignature,
  chooseAnchor,
  extractPages,
  locateZone,
  looksLikePdf,
  openPdf,
  renderPage,
  type LocatedZone,
  type PdfDocument,
} from '../platform/pdf';
import { useApp } from '../state/AppContext';
import { Button, Modal, Notice } from './ui';

interface Props {
  companyId: string;
  /** A requisition already loaded into the app to use as the sample. */
  fileHash?: string;
  onClose: () => void;
}

const MIN_BOX = 0.015;
const MAX_PAGES = 8;

interface Reading {
  at: LocatedZone; // where the box sits on the sample that is open
  result: InkAnalysis;
}

const followsText = (zone: SignatureZone) =>
  zone.anchor ? `follows the words "${zone.anchor.text}", on any page` : `fixed place on page ${zone.page}`;

/**
 * Teaches the app where the approver signs on one kind of form: draw a box on
 * a sample and see at once whether that sample reads as signed. A form can
 * have several boxes (for example page one, or the note on page two); a
 * signature in any of them counts.
 */
export function SignatureZoneModal({ companyId, fileHash, onClose }: Props) {
  const { store, run, notify } = useApp();
  const company = store.companies.find((c) => c.id === companyId);

  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [sampleName, setSampleName] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const [formType, setFormType] = useState<DocumentType | null>(null);
  const formTypeRef = useRef<DocumentType | null>(null);

  // Boxes kept for this kind of form, and what each reads on the open sample.
  const [zones, setZones] = useState<SignatureZone[]>([]);
  const [readings, setReadings] = useState<(Reading | null)[]>([]);

  // The box being drawn now.
  const [draft, setDraft] = useState<LocatedZone | null>(null);
  const [draftZone, setDraftZone] = useState<SignatureZone | null>(null);
  const draftZoneRef = useRef<SignatureZone | null>(null);
  const [draftResult, setDraftResult] = useState<InkAnalysis | null>(null);
  const dragStart = useRef<{ page: number; x: number; y: number } | null>(null);

  const [ignoreTypedText, setIgnoreTypedText] = useState(true);
  const [borrowed, setBorrowed] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function clearDraft() {
    setDraft(null);
    setDraftZone(null);
    draftZoneRef.current = null;
    setDraftResult(null);
  }

  async function load(bytes: Uint8Array, name: string) {
    setError('');
    if (!looksLikePdf(bytes)) return setError('That file is not a PDF.');
    try {
      const doc = await openPdf(bytes);
      const type = formTypeOf(await extractPages(doc));
      if (type !== formTypeRef.current) {
        // A different kind of form: start from the boxes saved for it, or the
        // ones another company already uses for the same form, as a suggestion.
        const own = company?.signatureZones[type] ?? [];
        const other = own.length ? [] : store.companies.map((c) => c.signatureZones[type] ?? []).find((z) => z.length > 0) ?? [];
        formTypeRef.current = type;
        setFormType(type);
        setZones(own.length ? own : other);
        setBorrowed(own.length === 0 && other.length > 0);
        setChanged(own.length === 0 && other.length > 0);
        clearDraft();
      } else if (draftZoneRef.current) {
        // Same kind of form: carry the box being drawn over to the new sample.
        setDraft(await locateZone(doc, draftZoneRef.current));
        setDraftResult(null);
      }
      setReadings([]);
      setPages([]);
      setPdf(doc); // the previous sample is released by the effect below
      setSampleName(name);
    } catch {
      setError('Could not open that PDF.');
    }
  }

  // Start from the requisition that brought the user here, if there is one.
  useEffect(() => {
    if (!fileHash) return;
    void api.readPdf(fileHash).then((bytes) => {
      if (bytes) void load(bytes, 'the held requisition');
    });
  }, [fileHash]);

  useEffect(() => () => void pdf?.destroy(), [pdf]);

  // Draw every page, one under another.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    void (async () => {
      const images: string[] = [];
      for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES) && !cancelled; n++) {
        try {
          images.push((await renderPage(pdf, n, 1.5)).canvas.toDataURL('image/png'));
        } catch {
          return; // the sample was swapped while drawing
        }
        if (!cancelled) setPages([...images]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  // Read each saved box on the open sample.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    setReadings(zones.map(() => null));
    zones.forEach((zone, i) => {
      Promise.all([locateZone(pdf, zone), checkSignature(pdf, zone)])
        .then(([at, result]) => {
          if (!cancelled) setReadings((r) => r.map((old, j) => (j === i ? { at, result } : old)));
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, zones]);

  // Read the box being drawn, and find the label it should follow.
  useEffect(() => {
    if (!pdf || !draft || dragStart.current) return;
    let cancelled = false;
    setDraftResult(null);
    const absolute: SignatureZone = { ...draft, ignoreTypedText };
    Promise.all([checkSignature(pdf, absolute), chooseAnchor(pdf, draft)])
      .then(([result, anchor]) => {
        if (cancelled) return;
        const zone: SignatureZone = anchor ? { ...absolute, anchor } : absolute;
        draftZoneRef.current = zone;
        setDraftZone(zone);
        setDraftResult(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pdf, draft, ignoreTypedText]);

  function pointer(e: MouseEvent<HTMLDivElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function onMouseDown(e: MouseEvent<HTMLDivElement>, page: number) {
    e.preventDefault();
    const p = pointer(e);
    dragStart.current = { page, ...p };
    setBorrowed(false);
    setDraftResult(null);
    setDraft({ page, ...p, w: 0, h: 0 });
  }

  function onMouseMove(e: MouseEvent<HTMLDivElement>, page: number) {
    const start = dragStart.current;
    if (!start || start.page !== page) return;
    const p = pointer(e);
    setDraft({ page, x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
  }

  function onMouseUp() {
    if (!dragStart.current) return;
    dragStart.current = null;
    setDraft((d) => {
      if (d && d.w >= MIN_BOX && d.h >= MIN_BOX) {
        setChanged(true);
        return { ...d };
      }
      draftZoneRef.current = null;
      setDraftZone(null);
      return null;
    });
  }

  function removeZone(index: number) {
    setZones((z) => z.filter((_, i) => i !== index));
    setBorrowed(false);
    setChanged(true);
  }

  function save() {
    if (!company || !formType) return;
    const next = [...zones, ...(draftZone ? [{ ...draftZone, ignoreTypedText }] : [])];
    const ok = run((s, ctx) => {
      const latest = s.companies.find((c) => c.id === company.id);
      return latest ? saveCompany(s, ctx, { ...latest, signatureZones: { ...latest.signatureZones, [formType]: next } }) : s;
    });
    if (ok) {
      notify('success', `Signature ${next.length === 1 ? 'box' : 'boxes'} saved for ${company.name} — ${FORM_LABELS[formType]}. Waiting requisitions are being re-checked.`);
      onClose();
    }
  }

  if (!company) return null;

  // What the sample reads as, taking every box together.
  const results = [...readings.map((r) => r?.result ?? null), ...(draft ? [draftResult] : [])];
  const waiting = results.some((r) => r === null);
  const signedOne = results.find((r) => r?.signed);
  const fullest = results.reduce<InkAnalysis | null>((a, b) => (b && (!a || b.inkMm2 > a.inkMm2) ? b : a), null);
  const shown = signedOne ?? fullest;
  const verdict = results.length === 0 ? 'none' : waiting ? 'pending' : signedOne ? 'true' : 'false';
  const canSave = !!pdf && !!formType && changed && !(draft && !draftZone);

  return (
    <Modal
      title={`Signature boxes — ${company.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!canSave} data-testid="zone-save">
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Notice tone="blue">
          <strong>1.</strong> Open a requisition for this company. <strong>2.</strong> Scroll to where the approver signs — on
          any page — and drag a box around it. The typed name and the underline can be inside the box. <strong>3.</strong> Try
          an unsigned copy too: it must read <em>Not signed</em>.
        </Notice>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => fileRef.current?.click()}>
            <FileUp size={14} /> {pdf ? 'Try another PDF…' : 'Open a sample PDF…'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            data-testid="zone-file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) await load(new Uint8Array(await file.arrayBuffer()), file.name);
            }}
          />
          {pdf && <span className="text-xs text-gray-500">Showing {sampleName}</span>}
          {pdf && formType && (
            <span className="text-xs font-medium text-ncba-dark bg-ncba-light rounded-full px-2.5 py-1" data-testid="zone-form" data-form={formType}>
              {FORM_LABELS[formType]}
            </span>
          )}
          {pdf && (
            <span className="text-xs text-gray-500" data-testid="zone-page-count">
              {pdf.numPages === 1 ? '1 page' : `${pdf.numPages} pages — scroll down for the rest`}
            </span>
          )}
          <label className="text-xs text-gray-600 flex items-center gap-2">
            <input type="checkbox" checked={ignoreTypedText} onChange={(e) => setIgnoreTypedText(e.target.checked)} />
            Ignore typed text inside a new box (a typed name is not a signature)
          </label>
        </div>

        {error && <Notice tone="red">{error}</Notice>}
        {borrowed && zones.length > 0 && (
          <Notice tone="amber">
            Copied from another company that uses the same form. Check the box sits on the signature here, then save.
          </Notice>
        )}

        {/* Always present once a sample is open, so the page never jumps while a box is being dragged. */}
        {pdf && (
          <div
            data-testid="zone-verdict"
            data-signed={verdict}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm border min-h-[4.25rem] ${
              verdict === 'true'
                ? 'bg-green-50 border-green-200 text-green-900'
                : verdict === 'false'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-gray-50 border-gray-200 text-gray-500'
            }`}
          >
            {verdict === 'none' ? (
              'No box yet. Drag one on the page below, around where the approver signs.'
            ) : verdict === 'pending' || !shown ? (
              'Reading…'
            ) : (
              <>
                {shown.signed ? <CheckCircle size={18} /> : <XCircle size={18} />}
                <span>
                  This sample reads as <strong>{shown.signed ? 'SIGNED' : 'NOT SIGNED'}</strong>
                  <span className="text-xs opacity-80">
                    {' '}
                    — mark found: {shown.widthMm} × {shown.heightMm} mm, {shown.inkMm2} mm² of ink (a signature needs at least{' '}
                    {SIGNATURE_MINIMUM.widthMm} × {SIGNATURE_MINIMUM.heightMm} mm and {SIGNATURE_MINIMUM.inkMm2} mm²)
                  </span>
                </span>
              </>
            )}
          </div>
        )}

        {pdf ? (
          <div className="relative border border-gray-300 rounded-lg overflow-auto bg-gray-200 max-h-[52vh] p-3 space-y-3" data-testid="zone-scroller">
            {pages.map((image, index) => {
              const page = index + 1;
              return (
                <div
                  key={page}
                  className="relative select-none cursor-crosshair mx-auto shadow"
                  style={{ width: 'min(100%, 820px)' }}
                  onMouseDown={(e) => onMouseDown(e, page)}
                  onMouseMove={(e) => onMouseMove(e, page)}
                  onMouseUp={onMouseUp}
                  onMouseLeave={onMouseUp}
                  data-testid="zone-page"
                  data-page={page}
                >
                  <img src={image} alt={`Page ${page}`} className="block w-full" draggable={false} />
                  <span className="absolute top-1 left-1 text-[10px] bg-gray-800/70 text-white rounded px-1.5 py-0.5 pointer-events-none">
                    Page {page} of {pdf.numPages}
                  </span>
                  {readings.map(
                    (r, i) =>
                      r?.at.page === page && (
                        <div
                          key={i}
                          className="absolute border-2 border-gray-700 bg-gray-700/10 pointer-events-none"
                          style={{ left: `${r.at.x * 100}%`, top: `${r.at.y * 100}%`, width: `${r.at.w * 100}%`, height: `${r.at.h * 100}%` }}
                        >
                          <span className="absolute -top-4 left-0 text-[10px] font-bold text-gray-700">{i + 1}</span>
                        </div>
                      )
                  )}
                  {draft?.page === page && (
                    <div
                      className="absolute border-2 border-ncba-teal bg-ncba-teal/15 pointer-events-none"
                      style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }}
                    />
                  )}
                </div>
              );
            })}
            {pages.length === 0 && <p className="py-16 text-center text-sm text-gray-500">Drawing the pages…</p>}
            {pdf.numPages > MAX_PAGES && <p className="text-center text-xs text-gray-500">Only the first {MAX_PAGES} pages are shown.</p>}
          </div>
        ) : (
          <div className="border border-dashed border-gray-300 rounded-lg py-16 text-center text-sm text-gray-400">
            Open a sample requisition to begin. Each kind of form this company uses gets its own boxes.
          </div>
        )}

        {/* Below the pages on purpose: nothing above them may change size while a box is being dragged. */}
        {(zones.length > 0 || draft) && (
          <ul className="text-xs text-gray-700 space-y-1" data-testid="zone-boxes">
            {zones.map((zone, i) => (
              <li key={i} className="flex items-center gap-2" data-box="saved">
                <span className="w-5 h-5 rounded bg-gray-700 text-white flex items-center justify-center font-bold shrink-0">{i + 1}</span>
                <span>
                  Box {i + 1}: {followsText(zone)}
                  {readings[i] && ` — here on page ${readings[i]!.at.page}: ${readings[i]!.result.signed ? 'signed' : 'not signed'}`}
                </span>
                <button className="text-red-600 hover:underline inline-flex items-center gap-1" onClick={() => removeZone(i)} data-testid="zone-remove">
                  <Trash2 size={12} /> Remove
                </button>
              </li>
            ))}
            {draft && (
              <li className="flex items-center gap-2" data-box="new">
                <span className="w-5 h-5 rounded bg-ncba-teal text-white flex items-center justify-center font-bold shrink-0">+</span>
                <span>
                  New box on page {draft.page}
                  {draftZone && `: ${followsText(draftZone)}`}
                  {draftResult && ` — ${draftResult.signed ? 'signed' : 'not signed'}`}
                </span>
                <button className="text-gray-600 hover:underline" onClick={clearDraft}>
                  Discard
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </Modal>
  );
}
