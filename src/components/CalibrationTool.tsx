import { useState, useRef, useCallback, useEffect } from 'react';
import { Move, Save, RefreshCw, Printer, Upload, Info } from 'lucide-react';
import { CompanyProfile, FieldPosition, ChequeTemplate } from '../types';
import { useApp } from '../context/AppContext';
import { DEFAULT_TEMPLATE } from '../lib/storage';

type FieldKey = keyof ChequeTemplate['fields'];

const FIELD_LABELS: Record<FieldKey, string> = {
  date: 'Date',
  payee: 'Pay To',
  amountWords: 'Amount (Words)',
  amountFigures: 'Amount (Figures)',
};

const FIELD_COLORS: Record<FieldKey, string> = {
  date: '#2196F3',
  payee: '#4CAF50',
  amountWords: '#FF9800',
  amountFigures: '#E91E63',
};

const SAMPLE: Record<FieldKey, string> = {
  date: '05/06/2026',
  payee: 'Paul Angalushe',
  amountWords: 'Fifteen Thousand Kenya Shillings Only',
  amountFigures: '15,000',
};

// Display scale: 1mm = SCALE px on screen
const SCALE = 3.2;

interface Props {
  company: CompanyProfile;
}

export function CalibrationTool({ company }: Props) {
  const { dispatch } = useApp();
  const [template, setTemplate] = useState<ChequeTemplate>(
    structuredClone(company.template)
  );
  const [selected, setSelected] = useState<FieldKey | null>(null);
  const [dragging, setDragging] = useState<FieldKey | null>(null);
  const [dragStart, setDragStart] = useState<{ mx: number; my: number; fx: number; fy: number } | null>(null);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const W = template.chequeWidth * SCALE;
  const H = template.chequeHeight * SCALE;

  function updateField(key: FieldKey, patch: Partial<FieldPosition>) {
    setTemplate((t) => ({
      ...t,
      fields: {
        ...t.fields,
        [key]: { ...t.fields[key], ...patch },
      },
    }));
  }

  function nudge(key: FieldKey, axis: 'x' | 'y', delta: number) {
    const field = template.fields[key];
    updateField(key, { [axis]: Math.max(0, parseFloat((field[axis] + delta).toFixed(1))) });
  }

  function save() {
    dispatch({
      type: 'UPSERT_COMPANY',
      company: { ...company, template },
    });
  }

  function resetToDefault() {
    setTemplate(structuredClone(DEFAULT_TEMPLATE));
  }

  function handleBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setBgImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  const onMouseDown = useCallback(
    (e: React.MouseEvent, key: FieldKey) => {
      e.preventDefault();
      e.stopPropagation();
      setSelected(key);
      setDragging(key);
      const field = template.fields[key];
      setDragStart({ mx: e.clientX, my: e.clientY, fx: field.x, fy: field.y });
    },
    [template]
  );

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging || !dragStart || !canvasRef.current) return;
      const dx = (e.clientX - dragStart.mx) / SCALE;
      const dy = (e.clientY - dragStart.my) / SCALE;
      updateField(dragging, {
        x: Math.max(0, Math.min(template.chequeWidth - 10, parseFloat((dragStart.fx + dx).toFixed(1)))),
        y: Math.max(0, Math.min(template.chequeHeight - 5, parseFloat((dragStart.fy + dy).toFixed(1)))),
      });
    }
    function onMouseUp() {
      setDragging(null);
      setDragStart(null);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, dragStart, template.chequeWidth, template.chequeHeight]);

  function printTest() {
    const win = window.open('', '_blank');
    if (!win) return;
    const topOffset = template.pageTopOffset;
    const fields = template.fields;

    const fieldHtml = (Object.keys(fields) as FieldKey[])
      .map((key) => {
        const f = fields[key];
        return `<div style="
          position:absolute;
          left:${f.x}mm; top:${f.y + topOffset}mm;
          width:${f.width}mm;
          font-family:${f.fontFamily};
          font-size:${f.fontSize}pt;
          font-weight:${f.fontWeight};
          text-align:${f.align};
          white-space:nowrap;
          overflow:hidden;
        ">${SAMPLE[key]}</div>`;
      })
      .join('');

    win.document.write(`<!DOCTYPE html>
<html><head>
<title>Cheque Test Print — ${company.name}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  body { margin: 0; padding: 0; }
  .cheque-area {
    position: absolute;
    top: ${topOffset}mm; left: 0;
    width: ${template.chequeWidth}mm;
    height: ${template.chequeHeight}mm;
    border-top: 0.5pt dashed #999;
    border-bottom: 0.5pt dashed #999;
  }
</style>
</head><body>
<div class="cheque-area">${fieldHtml}</div>
</body></html>`);
    win.document.close();
    win.print();
  }

  const selField = selected ? template.fields[selected] : null;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Info size={14} />
          Drag fields to position them. Use nudge buttons for 0.5mm fine-tuning.
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => bgInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
            title="Upload a scan of your blank NCBA cheque as background"
          >
            <Upload size={14} />
            Load cheque scan
          </button>
          <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
          <button
            onClick={resetToDefault}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
          >
            <RefreshCw size={14} />
            Reset defaults
          </button>
          <button
            onClick={printTest}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-ncba-teal text-ncba-teal rounded-lg hover:bg-ncba-light transition-colors"
          >
            <Printer size={14} />
            Print test
          </button>
          <button
            onClick={save}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-ncba-teal text-white rounded-lg hover:bg-ncba-dark transition-colors"
          >
            <Save size={14} />
            Save positions
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Visual canvas */}
        <div className="flex-1 overflow-auto">
          <p className="text-xs text-gray-500 mb-2">
            Cheque: {template.chequeWidth}mm × {template.chequeHeight}mm
          </p>
          <div
            ref={canvasRef}
            className="relative border-2 border-dashed border-gray-400 bg-gray-100 select-none"
            style={{ width: W, height: H, cursor: dragging ? 'grabbing' : 'default' }}
            onClick={() => setSelected(null)}
          >
            {bgImage && (
              <img
                src={bgImage}
                alt="cheque background"
                className="absolute inset-0 w-full h-full object-fill opacity-60"
                draggable={false}
              />
            )}

            {(Object.keys(template.fields) as FieldKey[]).map((key) => {
              const f = template.fields[key];
              const isSelected = selected === key;
              const color = FIELD_COLORS[key];

              return (
                <div
                  key={key}
                  onMouseDown={(e) => onMouseDown(e, key)}
                  style={{
                    position: 'absolute',
                    left: f.x * SCALE,
                    top: f.y * SCALE,
                    width: f.width * SCALE,
                    cursor: 'grab',
                    outline: isSelected ? `2px solid ${color}` : `1px dashed ${color}`,
                    backgroundColor: `${color}18`,
                    padding: '1px 3px',
                    userSelect: 'none',
                    zIndex: isSelected ? 10 : 1,
                  }}
                  onClick={(e) => { e.stopPropagation(); setSelected(key); }}
                >
                  <span
                    style={{
                      fontFamily: f.fontFamily,
                      fontSize: f.fontSize * SCALE * 0.38,
                      fontWeight: f.fontWeight,
                      color: '#333',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      display: 'block',
                      maxWidth: f.width * SCALE,
                    }}
                  >
                    {SAMPLE[key]}
                  </span>
                  <span
                    style={{
                      position: 'absolute',
                      top: -14,
                      left: 0,
                      fontSize: 9,
                      color,
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {FIELD_LABELS[key]}
                  </span>
                </div>
              );
            })}

            {/* Ruler guides */}
            <div className="absolute inset-0 pointer-events-none">
              {[25, 50, 75, 100, 125, 150, 175, 200].map((mm) => (
                <div
                  key={mm}
                  style={{
                    position: 'absolute',
                    left: mm * SCALE,
                    top: 0,
                    bottom: 0,
                    borderLeft: '1px solid rgba(0,0,0,0.06)',
                  }}
                />
              ))}
              {[20, 40, 60].map((mm) => (
                <div
                  key={mm}
                  style={{
                    position: 'absolute',
                    top: mm * SCALE,
                    left: 0,
                    right: 0,
                    borderTop: '1px solid rgba(0,0,0,0.06)',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Control panel */}
        <div className="w-72 shrink-0 space-y-4">
          {/* Field selector */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Select field to edit</p>
            <div className="space-y-1">
              {(Object.keys(template.fields) as FieldKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                    selected === key ? 'bg-gray-800 text-white' : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: FIELD_COLORS[key] }}
                  />
                  {FIELD_LABELS[key]}
                  {selected === key && (
                    <Move size={12} className="ml-auto opacity-60" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Position controls */}
          {selected && selField && (
            <div className="border border-gray-200 rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-700">{FIELD_LABELS[selected]} position</p>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500">X (mm from left)</label>
                  <div className="flex items-center gap-1 mt-1">
                    <button onClick={() => nudge(selected, 'x', -0.5)} className="w-6 h-6 flex items-center justify-center border rounded text-sm hover:bg-gray-100">−</button>
                    <input
                      type="number"
                      className="w-14 border rounded px-1 py-0.5 text-xs text-center"
                      value={selField.x}
                      step={0.5}
                      onChange={(e) => updateField(selected, { x: parseFloat(e.target.value) || 0 })}
                    />
                    <button onClick={() => nudge(selected, 'x', 0.5)} className="w-6 h-6 flex items-center justify-center border rounded text-sm hover:bg-gray-100">+</button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Y (mm from top)</label>
                  <div className="flex items-center gap-1 mt-1">
                    <button onClick={() => nudge(selected, 'y', -0.5)} className="w-6 h-6 flex items-center justify-center border rounded text-sm hover:bg-gray-100">−</button>
                    <input
                      type="number"
                      className="w-14 border rounded px-1 py-0.5 text-xs text-center"
                      value={selField.y}
                      step={0.5}
                      onChange={(e) => updateField(selected, { y: parseFloat(e.target.value) || 0 })}
                    />
                    <button onClick={() => nudge(selected, 'y', 0.5)} className="w-6 h-6 flex items-center justify-center border rounded text-sm hover:bg-gray-100">+</button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">Width (mm)</label>
                <input
                  type="number"
                  className="mt-1 w-full border rounded px-2 py-1 text-xs"
                  value={selField.width}
                  step={1}
                  onChange={(e) => updateField(selected, { width: parseFloat(e.target.value) || 10 })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500">Font size (pt)</label>
                  <input
                    type="number"
                    className="mt-1 w-full border rounded px-2 py-1 text-xs"
                    value={selField.fontSize}
                    min={6}
                    max={18}
                    onChange={(e) => updateField(selected, { fontSize: parseInt(e.target.value) || 10 })}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Align</label>
                  <select
                    className="mt-1 w-full border rounded px-1 py-1 text-xs"
                    value={selField.align}
                    onChange={(e) => updateField(selected, { align: e.target.value as FieldPosition['align'] })}
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">Font weight</label>
                <select
                  className="mt-1 w-full border rounded px-1 py-1 text-xs"
                  value={selField.fontWeight}
                  onChange={(e) => updateField(selected, { fontWeight: e.target.value as FieldPosition['fontWeight'] })}
                >
                  <option value="normal">Normal</option>
                  <option value="bold">Bold</option>
                </select>
              </div>
            </div>
          )}

          {/* Page offset */}
          <div className="border border-gray-200 rounded-lg p-3">
            <label className="text-xs font-semibold text-gray-700 block mb-1">
              Page top offset (mm)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Distance from top of paper to start of cheque area. Set to 0 for standalone cheque leaves.
            </p>
            <input
              type="number"
              className="w-full border rounded px-2 py-1 text-sm"
              value={template.pageTopOffset}
              step={1}
              min={0}
              onChange={(e) =>
                setTemplate((t) => ({ ...t, pageTopOffset: parseFloat(e.target.value) || 0 }))
              }
            />
          </div>

          {/* Cheque dimensions */}
          <div className="border border-gray-200 rounded-lg p-3">
            <label className="text-xs font-semibold text-gray-700 block mb-2">
              Cheque dimensions (mm)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500">Width</label>
                <input
                  type="number"
                  className="mt-1 w-full border rounded px-2 py-1 text-xs"
                  value={template.chequeWidth}
                  step={1}
                  onChange={(e) =>
                    setTemplate((t) => ({ ...t, chequeWidth: parseFloat(e.target.value) || 215 }))
                  }
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Height</label>
                <input
                  type="number"
                  className="mt-1 w-full border rounded px-2 py-1 text-xs"
                  value={template.chequeHeight}
                  step={1}
                  onChange={(e) =>
                    setTemplate((t) => ({ ...t, chequeHeight: parseFloat(e.target.value) || 85 }))
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
