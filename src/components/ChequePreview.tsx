import { FONT_STACKS, pageSizeMm, type ChequeLayout } from '../core/layout';
import type { ChequeTemplate } from '../core/types';

const PT_TO_MM = 25.4 / 72;

interface Props {
  layout: ChequeLayout;
  template: ChequeTemplate;
  /** Screen pixels per millimetre. */
  scale?: number;
}

/**
 * Draws a cheque layout on screen from exactly the same positions the
 * printer receives. Pre-printed parts of the cheque are not shown.
 */
export function ChequePreview({ layout, template, scale = 3.2 }: Props) {
  const { widthMm, heightMm } = pageSizeMm(template);
  return (
    <div
      className="relative bg-white border-2 border-gray-400 overflow-hidden"
      style={{ width: widthMm * scale, height: heightMm * scale }}
      data-testid="cheque-preview"
    >
      {template.pageTopOffset > 0 && (
        <div className="absolute inset-x-0 top-0 bg-gray-100 border-b border-dashed border-gray-300" style={{ height: template.pageTopOffset * scale }} />
      )}
      {heightMm > template.pageTopOffset + template.chequeHeight && (
        <div
          className="absolute inset-x-0 bottom-0 bg-gray-100 border-t border-dashed border-gray-300"
          style={{ top: (template.pageTopOffset + template.chequeHeight) * scale }}
          title="Blank part of the printer's sheet below the cheque"
        />
      )}
      {layout.fields.flatMap((field) =>
        field.lines.map((line, i) => (
          <div
            key={`${field.key}-${i}`}
            data-field={field.key}
            style={{
              position: 'absolute',
              left: line.xMm * scale,
              top: line.yMm * scale,
              width: field.widthMm * scale,
              height: field.lineHeightMm * scale,
              lineHeight: `${field.lineHeightMm * scale}px`,
              fontSize: field.fontPt * PT_TO_MM * scale,
              fontFamily: FONT_STACKS[field.fontFamily],
              fontWeight: field.fontWeight,
              textAlign: field.align,
              whiteSpace: 'pre',
              color: field.overflow ? '#b91c1c' : '#000',
            }}
          >
            {line.text}
          </div>
        ))
      )}
    </div>
  );
}
