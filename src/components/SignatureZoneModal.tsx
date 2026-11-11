import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { CheckCircle, FileUp, XCircle } from 'lucide-react';
import { SIGNATURE_MINIMUM, type InkAnalysis } from '../core/signature';
import { saveCompany } from '../core/store';
import type { SignatureZone } from '../core/types';
import { api } from '../platform/api';
import { checkSignature, looksLikePdf, openPdf, renderPage, type PdfDocument } from '../platform/pdf';
import { useApp } from '../state/AppContext';
import { Button, Modal, Notice } from './ui';

interface Props {
  companyId: string;
  /** A requisition already loaded into the app to use as the sample. */
  fileHash?: string;
  onClose: () => void;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_BOX = 0.015;

/**
 * Teaches the app where the approver signs on a company's requisition form:
 * draw a box on a sample, and see at once whether that sample reads as signed.
 */
export function SignatureZoneModal({ companyId, fileHash, onClose }: Props) {
  const { store, run, notify } = useApp();
  const company = store.companies.find((c) => c.id === companyId);
  const saved = company?.signatureZone ?? null;

  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [sampleName, setSampleName] = useState('');
  const [pageNumber, setPageNumber] = useState(saved?.page ?? 1);
  const [image, setImage] = useState('');
  const [box, setBox] = useState<Box | null>(saved ? { x: saved.x, y: saved.y, w: saved.w, h: saved.h } : null);
  const [ignoreTypedText, setIgnoreTypedText] = useState(saved?.ignoreTypedText ?? true);
  const [verdict, setVerdict] = useState<InkAnalysis | null>(null);
  const [error, setError] = useState('');
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(bytes: Uint8Array, name: string) {
    setError('');
    if (!looksLikePdf(bytes)) return setError('That file is not a PDF.');
    try {
      const doc = await openPdf(bytes);
      setVerdict(null);
      setPdf(doc); // the previous sample is released by the effect below
      setSampleName(name);
      setPageNumber((p) => Math.min(Math.max(1, p), doc.numPages));
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

  // Draw the chosen page.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    renderPage(pdf, pageNumber, 1.5)
      .then(({ canvas }) => {
        if (!cancelled) setImage(canvas.toDataURL('image/png'));
      })
      .catch(() => undefined); // the sample was swapped while drawing
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber]);

  // Re-read the box whenever it, the sample or the options change.
  useEffect(() => {
    if (!pdf || !box || dragStart.current) return;
    let cancelled = false;
    setVerdict(null);
    const zone: SignatureZone = { page: pageNumber, ...box, ignoreTypedText };
    checkSignature(pdf, zone)
      .then((result) => {
        if (!cancelled) setVerdict(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, box, ignoreTypedText]);

  function pointer(e: MouseEvent): { x: number; y: number } {
    const rect = pageRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function onMouseDown(e: MouseEvent) {
    e.preventDefault();
    dragStart.current = pointer(e);
    setVerdict(null);
    setBox({ ...dragStart.current, w: 0, h: 0 });
  }

  function onMouseMove(e: MouseEvent) {
    const start = dragStart.current;
    if (!start) return;
    const p = pointer(e);
    setBox({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
  }

  function onMouseUp() {
    if (!dragStart.current) return;
    dragStart.current = null;
    setBox((b) => (b && b.w >= MIN_BOX && b.h >= MIN_BOX ? { ...b } : null));
  }

  function save() {
    if (!company || !box) return;
    const signatureZone: SignatureZone = { page: pageNumber, ...box, ignoreTypedText };
    if (run((s, ctx) => saveCompany(s, ctx, { ...company, signatureZone }))) {
      notify('success', `Signature box saved for ${company.name}. Waiting requisitions are being re-checked.`);
      onClose();
    }
  }

  if (!company) return null;

  return (
    <Modal
      title={`Signature box — ${company.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!box || !pdf} data-testid="zone-save">
            Save signature box
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Notice tone="blue">
          <strong>1.</strong> Open a requisition for this company. <strong>2.</strong> Drag a box around the empty space where
          the approver signs — leave out printed labels where you can. <strong>3.</strong> Test both a signed and an unsigned
          copy: the unsigned one must read <em>Not signed</em>.
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
          {pdf && pdf.numPages > 1 && (
            <label className="text-xs text-gray-600 flex items-center gap-2">
              Page
              <select
                className="border rounded px-2 py-1"
                value={pageNumber}
                onChange={(e) => {
                  setPageNumber(Number(e.target.value));
                  setBox(null);
                }}
              >
                {Array.from({ length: pdf.numPages }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs text-gray-600 flex items-center gap-2">
            <input type="checkbox" checked={ignoreTypedText} onChange={(e) => setIgnoreTypedText(e.target.checked)} />
            Ignore typed text inside the box (a typed name is not a signature)
          </label>
        </div>

        {error && <Notice tone="red">{error}</Notice>}

        {/* Always present once a sample is open, so the page never jumps while a box is being dragged. */}
        {pdf && (
          <div
            data-testid="zone-verdict"
            data-signed={!box ? 'none' : verdict ? String(verdict.signed) : 'pending'}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm border min-h-[4.25rem] ${
              !box || !verdict
                ? 'bg-gray-50 border-gray-200 text-gray-500'
                : verdict.signed
                ? 'bg-green-50 border-green-200 text-green-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {!box ? (
              'Drag a box on the page below, around where the approver signs.'
            ) : !verdict ? (
              'Reading the box…'
            ) : (
              <>
                {verdict.signed ? <CheckCircle size={18} /> : <XCircle size={18} />}
                <span>
                  This sample reads as <strong>{verdict.signed ? 'SIGNED' : 'NOT SIGNED'}</strong>
                  <span className="text-xs opacity-80">
                    {' '}
                    — mark found: {verdict.widthMm} × {verdict.heightMm} mm, {verdict.inkMm2} mm² of ink (a signature needs at least{' '}
                    {SIGNATURE_MINIMUM.widthMm} × {SIGNATURE_MINIMUM.heightMm} mm and {SIGNATURE_MINIMUM.inkMm2} mm²)
                  </span>
                </span>
              </>
            )}
          </div>
        )}

        {image ? (
          <div className="border border-gray-300 rounded-lg overflow-auto bg-gray-100 max-h-[55vh]">
            <div
              ref={pageRef}
              className="relative select-none cursor-crosshair mx-auto"
              style={{ width: 'min(100%, 820px)' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              data-testid="zone-page"
            >
              <img src={image} alt="Requisition page" className="block w-full" draggable={false} />
              {box && (
                <div
                  className="absolute border-2 border-ncba-teal bg-ncba-teal/15 pointer-events-none"
                  style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-gray-300 rounded-lg py-16 text-center text-sm text-gray-400">
            {saved ? 'A signature box is already saved. Open a sample PDF to see or change it.' : 'Open a sample requisition to begin.'}
          </div>
        )}
      </div>
    </Modal>
  );
}
