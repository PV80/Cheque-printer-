import { useEffect, useId, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { AlertTriangle, Copy, Info, Printer, RefreshCw, Save, Upload } from 'lucide-react';
import { buildPrintHtml, DEFAULT_TEMPLATE, describeOffSheet, FIELD_KEYS, fieldName, FONT_STACKS, layoutCheque, pageSizeMm, type ChequeValues } from '../core/layout';
import { saveCompany } from '../core/store';
import type { ChequeTemplate, CompanyProfile, FieldKey, FieldPosition, FontFamily, PrinterType } from '../core/types';
import { api } from '../platform/api';
import { measureText } from '../platform/measure';
import { useApp } from '../state/AppContext';
import { Button } from './ui';

const FIELD_LABELS: Record<FieldKey, string> = {
  date: 'Date',
  payee: 'Payee',
  amountFigures: 'Amount in figures',
  amountWords: 'Amount in words',
};

const FIELD_COLORS: Record<FieldKey, string> = {
  date: '#2196F3',
  payee: '#4CAF50',
  amountFigures: '#E91E63',
  amountWords: '#FF9800',
};

// A long amount so the second line of the words field can be checked too.
const SAMPLE: ChequeValues = {
  date: '05/06/2026',
  payee: 'Sample Payee Name Limited',
  amountFigures: '1,234,567/=',
  amountWords: 'One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven Only',
};

const SCALE = 3.2; // screen pixels per mm
const PT_TO_MM = 25.4 / 72;
const FONTS: FontFamily[] = ['Arial', 'Courier New', 'Times New Roman'];
const round1 = (n: number) => Math.round(n * 10) / 10;
const UNREACHABLE_FILL = 'repeating-linear-gradient(135deg, rgba(220,38,38,0.30) 0 6px, rgba(220,38,38,0.10) 6px 12px)';

function NumberInput({ label, value, onChange, step = 0.5, hint }: { label: string; value: number; onChange: (n: number) => void; step?: number; hint?: string }) {
  const id = useId();
  // While someone is typing, show what they typed: the value itself may sit at a
  // limit until the number is complete (typing 127 passes through 1 and 12).
  const [typing, setTyping] = useState<string | null>(null);
  const nudge = (by: number) => {
    setTyping(null);
    onChange(round1(value + by));
  };
  return (
    <div>
      <label htmlFor={id} className="text-xs text-gray-500">
        {label}
      </label>
      <div className="flex items-center gap-1 mt-1">
        <button type="button" onClick={() => nudge(-step)} className="w-6 h-6 border rounded text-sm hover:bg-gray-100" aria-label={`Decrease ${label}`}>
          −
        </button>
        <input
          id={id}
          type="number"
          className="w-full min-w-0 border rounded px-1 py-0.5 text-xs text-center"
          value={typing ?? value}
          step={step}
          onChange={(e) => {
            setTyping(e.target.value);
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          onBlur={() => setTyping(null)}
        />
        <button type="button" onClick={() => nudge(step)} className="w-6 h-6 border rounded text-sm hover:bg-gray-100" aria-label={`Increase ${label}`}>
          +
        </button>
      </div>
      {hint && <span className="block text-xs text-gray-400 leading-tight mt-0.5">{hint}</span>}
    </div>
  );
}

/** Positions the four printed fields on one company's cheque and test-prints them. */
export function CalibrationTool({ company }: { company: CompanyProfile }) {
  const { store, run, notify } = useApp();
  const [template, setTemplate] = useState<ChequeTemplate>(() => structuredClone(company.template));
  const [printerType, setPrinterType] = useState<PrinterType>(company.printerType);
  const [offsetX, setOffsetX] = useState(company.printerOffsetX);
  const [offsetY, setOffsetY] = useState(company.printerOffsetY);
  const [selected, setSelected] = useState<FieldKey | null>(null);
  const [drag, setDrag] = useState<{ key: FieldKey; mx: number; my: number; fx: number; fy: number } | null>(null);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const others = store.companies.filter((c) => c.id !== company.id);
  const draft = { template, printerOffsetX: offsetX, printerOffsetY: offsetY };

  function change(next: ChequeTemplate) {
    setTemplate(next);
    setDirty(true);
  }

  function updateField(key: FieldKey, patch: Partial<FieldPosition>) {
    change({ ...template, fields: { ...template.fields, [key]: { ...template.fields[key], ...patch } } });
  }

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const x = round1(drag.fx + (e.clientX - drag.mx) / SCALE);
      const y = round1(drag.fy + (e.clientY - drag.my) / SCALE);
      setTemplate((t) => ({
        ...t,
        fields: {
          ...t.fields,
          [drag.key]: {
            ...t.fields[drag.key],
            x: Math.max(0, Math.min(t.chequeWidth - 5, x)),
            y: Math.max(0, Math.min(t.chequeHeight - 3, y)),
          },
        },
      }));
      setDirty(true);
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag]);

  function startDrag(e: ReactMouseEvent, key: FieldKey) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(key);
    setDrag({ key, mx: e.clientX, my: e.clientY, fx: template.fields[key].x, fy: template.fields[key].y });
  }

  function save() {
    const ok = run((s, ctx) => {
      const latest = s.companies.find((c) => c.id === company.id);
      if (!latest) return s;
      return saveCompany(s, ctx, { ...latest, template, printerType, printerOffsetX: offsetX, printerOffsetY: offsetY });
    });
    if (ok) {
      setDirty(false);
      notify('success', `Layout saved for ${company.name}.`);
    }
  }

  function choosePrinterType(type: PrinterType) {
    setPrinterType(type);
    // Dot-matrix printers are sharpest and fastest in a fixed-width font.
    const fontFamily: FontFamily = type === 'dot_matrix' ? 'Courier New' : 'Arial';
    const fields = { ...template.fields };
    for (const key of FIELD_KEYS) fields[key] = { ...fields[key], fontFamily };
    change({ ...template, fields });
  }

  function copyFrom(id: string) {
    const source = store.companies.find((c) => c.id === id);
    if (!source) return;
    change(structuredClone(source.template));
    setPrinterType(source.printerType);
    setOffsetX(source.printerOffsetX);
    setOffsetY(source.printerOffsetY);
    notify('info', `Copied the layout of ${source.name}. Adjust what differs, then save.`);
  }

  function resetToDefault() {
    change(structuredClone(DEFAULT_TEMPLATE));
    setOffsetX(0);
    setOffsetY(0);
  }

  function loadScan(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBgImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function printTest() {
    const layout = layoutCheque(SAMPLE, draft, measureText);
    const html = buildPrintHtml([layout], template, { title: `Test print — ${company.name}`, guides: true });
    try {
      const result = await api.print({ html, ...pageSizeMm(template), deviceName: company.printerName });
      if (result.ok && offSheet.length) notify('error', `Test page sent, but the ${offSheet.map((o) => fieldName(o.key)).join(' and ')} will be missing from it: see the warning under the cheque.`);
      else if (result.ok) notify('success', 'Test page sent. Hold it against a real cheque up to the light to compare.');
      else if (result.reason !== 'cancelled') notify('error', `The printer reported a problem: ${result.reason}`);
    } catch (err) {
      notify('error', `Could not print: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  // The on-screen cheque shows positions on the leaf itself, without printer offsets.
  const screenLayout = layoutCheque(SAMPLE, { template: { ...template, pageTopOffset: 0 }, printerOffsetX: 0, printerOffsetY: 0 }, measureText);
  const sel = selected ? template.fields[selected] : null;

  // What the printer would really be sent, with the printer shift applied.
  const sheet = pageSizeMm(template);
  const minSheet = template.chequeHeight + template.pageTopOffset;
  const printLayout = layoutCheque(SAMPLE, draft, measureText);
  const offSheet = printLayout.fields.flatMap((p) => (p.problem?.kind === 'off_sheet' ? [{ key: p.key, problem: p.problem }] : []));

  // Strips of the cheque that fall outside that sheet: nothing placed there can print.
  const originY = offsetY + template.pageTopOffset;
  const within = (n: number, max: number) => Math.min(max, Math.max(0, n));
  const unreachable = {
    top: within(-originY, template.chequeHeight),
    bottom: within(originY + template.chequeHeight - sheet.heightMm, template.chequeHeight),
    left: within(-offsetX, template.chequeWidth),
    right: within(offsetX + template.chequeWidth - sheet.widthMm, template.chequeWidth),
  };

  // A page shorter than the printer's own sheet is centred on it, so a print that
  // lands N mm low means the sheet is 2N mm longer than the page it was sent.
  const longerSheet = Math.ceil(sheet.heightMm + 2 * Math.abs(offsetY));
  const canUseLongerSheet = offsetY < 0 && offSheet.some((o) => o.problem.edge === 'top');

  function setSheetHeight(n: number) {
    const next = { ...template };
    if (n > minSheet) next.sheetHeight = Math.min(500, n);
    else delete next.sheetHeight;
    change(next);
  }

  function switchToLongerSheet() {
    setSheetHeight(longerSheet);
    setOffsetY(0);
    notify('info', `Sheet length set to ${longerSheet} mm and the upward shift removed. Print a test before saving.`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-gray-600">
          <Info size={14} /> Drag a field, or select it and nudge by 0.5 mm. Always confirm with a test print on plain paper.
        </p>
        <div className="flex flex-wrap gap-2">
          {others.length > 0 && (
            <label className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-2 text-gray-700 bg-white">
              <Copy size={14} />
              <select className="bg-transparent text-sm outline-none" value="" onChange={(e) => copyFrom(e.target.value)} aria-label="Copy layout from another company">
                <option value="">Copy layout from…</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button onClick={() => bgInputRef.current?.click()}>
            <Upload size={14} /> Cheque scan
          </Button>
          <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={loadScan} />
          <Button onClick={resetToDefault}>
            <RefreshCw size={14} /> Reset
          </Button>
          <Button onClick={() => void printTest()} data-testid="print-test">
            <Printer size={14} /> Print test
          </Button>
          <Button variant="primary" onClick={save} data-testid="save-layout">
            <Save size={14} /> {dirty ? 'Save layout *' : 'Save layout'}
          </Button>
        </div>
      </div>

      <div className="space-y-5">
        <div className="overflow-auto pt-3">
          <p className="text-xs text-gray-500 mb-2">
            {template.chequeWidth} × {template.chequeHeight} mm. "Pay", "Kenya Shillings", "Ksh" and "Date" are already printed on the cheque.
            {sheet.heightMm > minSheet && ` The printer is given a ${sheet.widthMm} × ${sheet.heightMm} mm sheet with the cheque at its top.`}
          </p>
          <div
            className="relative border-2 border-dashed border-gray-400 bg-gray-100 select-none"
            style={{ width: template.chequeWidth * SCALE, height: template.chequeHeight * SCALE, cursor: drag ? 'grabbing' : 'default' }}
            onClick={() => setSelected(null)}
          >
            {bgImage && <img src={bgImage} alt="" className="absolute inset-0 w-full h-full object-fill opacity-70" draggable={false} />}

            {[25, 50, 75, 100, 125, 150, 175, 200].map((mm) => (
              <div key={`v${mm}`} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: mm * SCALE, borderLeft: '1px solid rgba(0,0,0,0.07)' }} />
            ))}
            {[20, 40, 60, 80].map((mm) => (
              <div key={`h${mm}`} className="absolute left-0 right-0 pointer-events-none" style={{ top: mm * SCALE, borderTop: '1px solid rgba(0,0,0,0.07)' }} />
            ))}

            {(['top', 'bottom', 'left', 'right'] as const).map((edge) => {
              const size = unreachable[edge];
              if (size < 0.05) return null;
              const across = edge === 'top' || edge === 'bottom';
              return (
                <div
                  key={edge}
                  data-testid={`unreachable-${edge}`}
                  className="absolute pointer-events-none overflow-hidden"
                  style={{
                    [edge]: 0,
                    ...(across ? { left: 0, right: 0, height: size * SCALE } : { top: 0, bottom: 0, width: size * SCALE }),
                    background: UNREACHABLE_FILL,
                  }}
                >
                  {across && size >= 4 && (
                    <span className="absolute left-2 top-0.5 text-[10px] font-semibold text-red-800 bg-white/80 px-1 rounded">
                      The printer cannot reach this {round1(size)} mm strip
                    </span>
                  )}
                </div>
              );
            })}

            {FIELD_KEYS.map((key) => {
              const f = template.fields[key];
              const placed = screenLayout.fields.find((p) => p.key === key)!;
              const problem = printLayout.fields.find((p) => p.key === key)?.problem;
              const color = FIELD_COLORS[key];
              const boxHeight = f.wrap ? f.height ?? 18 : placed.lineHeightMm;
              return (
                <div
                  key={key}
                  onMouseDown={(e) => startDrag(e, key)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    left: f.x * SCALE,
                    top: f.y * SCALE,
                    width: f.width * SCALE,
                    height: boxHeight * SCALE,
                    cursor: 'grab',
                    outline: selected === key ? `2px solid ${color}` : `1px dashed ${color}`,
                    backgroundColor: `${color}20`,
                    zIndex: selected === key ? 10 : 1,
                  }}
                >
                  <span style={{ position: 'absolute', top: -14, left: 0, fontSize: 9, color, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                    {FIELD_LABELS[key]}
                    {problem?.kind === 'too_long'
                      ? ' — does not fit'
                      : problem?.kind === 'off_cheque'
                        ? ' — over the edge of the cheque'
                        : problem?.kind === 'off_sheet'
                          ? ' — the printer cannot reach it'
                          : placed.fontPt < f.fontSize
                            ? ` — shrunk to ${placed.fontPt}pt`
                            : ''}
                  </span>
                  {placed.lines.map((line, i) => (
                    <span
                      key={i}
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: (line.yMm - f.y) * SCALE,
                        width: '100%',
                        height: placed.lineHeightMm * SCALE,
                        lineHeight: `${placed.lineHeightMm * SCALE}px`,
                        fontFamily: FONT_STACKS[placed.fontFamily],
                        fontSize: placed.fontPt * PT_TO_MM * SCALE,
                        fontWeight: placed.fontWeight,
                        textAlign: placed.align,
                        whiteSpace: 'pre',
                        color: '#222',
                      }}
                    >
                      {line.text}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {offSheet.length > 0 && (
          <div role="alert" data-testid="layout-warning" className="border border-red-200 bg-red-50 rounded-lg p-3 text-sm text-red-900 space-y-2">
            <p className="flex items-start gap-2 font-medium">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                With these printer settings the {offSheet.map((o) => `${fieldName(o.key)} would print ${describeOffSheet(o.problem)}`).join(', and the ')}, so the
                printer would leave it out. Cheques for {company.name} are held until this is corrected.
              </span>
            </p>
            {canUseLongerSheet ? (
              <>
                <p>
                  When everything prints low by the same amount, the printer is using a longer sheet than the cheque — most cannot take paper shorter than
                  about 127 mm — and the cheque gets centred on it. Shifting up cannot reach above the top of the sheet. Tell the printer about the longer
                  sheet instead:
                </p>
                <Button variant="primary" onClick={switchToLongerSheet} data-testid="use-longer-sheet">
                  Use a {longerSheet} mm sheet and remove the shift
                </Button>
                <p className="text-xs">Then print a test on plain paper and check it against a cheque before saving.</p>
              </>
            ) : (
              <p>Reduce the printer shift, or move the field further from that edge.</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 items-start">
          <div className="space-y-3">
          <div className="space-y-1">
            {FIELD_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                  selected === key ? 'bg-gray-800 text-white' : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: FIELD_COLORS[key] }} />
                {FIELD_LABELS[key]}
              </button>
            ))}
          </div>

          {selected && sel && (
            <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-white">
              <p className="text-xs font-semibold text-gray-700">{FIELD_LABELS[selected]}</p>
              <div className="grid grid-cols-2 gap-2">
                <NumberInput label="X (mm from left)" value={sel.x} onChange={(x) => updateField(selected, { x: Math.max(0, x) })} />
                <NumberInput label="Y (mm from top)" value={sel.y} onChange={(y) => updateField(selected, { y: Math.max(0, y) })} />
                <NumberInput label="Width (mm)" value={sel.width} step={1} onChange={(width) => updateField(selected, { width: Math.max(5, width) })} />
                <NumberInput label="Font size (pt)" value={sel.fontSize} step={0.5} onChange={(fontSize) => updateField(selected, { fontSize: Math.min(24, Math.max(6, fontSize)) })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-gray-500">Font</span>
                  <select className="mt-1 w-full border rounded px-1 py-1 text-xs" value={sel.fontFamily} onChange={(e) => updateField(selected, { fontFamily: e.target.value as FontFamily })}>
                    {FONTS.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500">Weight</span>
                  <select className="mt-1 w-full border rounded px-1 py-1 text-xs" value={sel.fontWeight} onChange={(e) => updateField(selected, { fontWeight: e.target.value as FieldPosition['fontWeight'] })}>
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500">Align</span>
                  <select className="mt-1 w-full border rounded px-1 py-1 text-xs" value={sel.align} onChange={(e) => updateField(selected, { align: e.target.value as FieldPosition['align'] })}>
                    <option value="left">Left</option>
                    <option value="center">Centre</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-gray-500">Lines</span>
                  <select
                    className="mt-1 w-full border rounded px-1 py-1 text-xs"
                    value={sel.wrap ? 'yes' : 'no'}
                    onChange={(e) =>
                      updateField(selected, e.target.value === 'yes' ? { wrap: true, height: sel.height ?? 18, lineSpacing: sel.lineSpacing ?? 8.5 } : { wrap: false })
                    }
                  >
                    <option value="no">One line</option>
                    <option value="yes">Wraps</option>
                  </select>
                </label>
              </div>
              {sel.wrap && (
                <div className="grid grid-cols-2 gap-2">
                  <NumberInput label="Line spacing (mm)" value={sel.lineSpacing ?? 8.5} onChange={(lineSpacing) => updateField(selected, { lineSpacing: Math.max(2, lineSpacing) })} hint="Gap between the cheque's ruled lines" />
                  <NumberInput label="Space (mm)" value={sel.height ?? 18} step={1} onChange={(height) => updateField(selected, { height: Math.max(4, height) })} hint="Total height for all lines" />
                </div>
              )}
            </div>
          )}
          {!selected && <p className="text-xs text-gray-400 px-1">Select a field to change its position, size or font.</p>}
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-white">
            <p className="text-xs font-semibold text-gray-700">Printer</p>
            <label className="block">
              <span className="text-xs text-gray-500">Type</span>
              <select className="mt-1 w-full border rounded px-2 py-1 text-sm" value={printerType} onChange={(e) => choosePrinterType(e.target.value as PrinterType)}>
                <option value="laser">Laser / inkjet</option>
                <option value="dot_matrix">Dot matrix</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput label="Shift right (mm)" value={offsetX} onChange={(n) => { setOffsetX(n); setDirty(true); }} hint="Negative = left" />
              <NumberInput label="Shift down (mm)" value={offsetY} onChange={(n) => { setOffsetY(n); setDirty(true); }} hint="Negative = up" />
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-white">
            <p className="text-xs font-semibold text-gray-700">Cheque size</p>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput label="Width (mm)" value={template.chequeWidth} step={1} onChange={(n) => change({ ...template, chequeWidth: Math.min(400, Math.max(50, n)) })} />
              <NumberInput label="Height (mm)" value={template.chequeHeight} step={1} onChange={(n) => change({ ...template, chequeHeight: Math.min(400, Math.max(30, n)) })} />
            </div>
            <NumberInput
              label="Top of sheet to top of cheque (mm)"
              value={template.pageTopOffset}
              step={1}
              onChange={(n) => change({ ...template, pageTopOffset: Math.max(0, n) })}
              hint="0 for a loose cheque leaf"
            />
            <NumberInput
              label="Sheet length given to the printer (mm)"
              value={sheet.heightMm}
              step={1}
              onChange={setSheetHeight}
              hint={`${minSheet} = same as the cheque. If the whole print lands low, use 127 or more instead of shifting up: most printers cannot take a shorter sheet.`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
