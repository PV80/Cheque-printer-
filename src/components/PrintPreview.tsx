import { X, Printer } from 'lucide-react';
import { ChequeData } from '../types';
import { useApp } from '../context/AppContext';

const PREVIEW_SCALE = 3;

interface Props {
  cheque: ChequeData;
  onClose: () => void;
}

export function PrintPreview({ cheque, onClose }: Props) {
  const { state } = useApp();
  const company = state.companies.find((c) => c.id === cheque.companyId);
  const t = company?.template;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-800">
            Cheque Preview — CHQ #{cheque.chequeNumber}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5">
          {!t ? (
            <div className="text-center py-8 text-amber-700 bg-amber-50 rounded-lg">
              No company profile assigned. Go to Companies tab to set up calibration.
            </div>
          ) : (
            <div className="overflow-auto">
              <p className="text-xs text-gray-500 mb-3">
                Preview at {PREVIEW_SCALE}× scale — {t.chequeWidth}mm × {t.chequeHeight}mm cheque
              </p>
              <div
                className="relative border-2 border-gray-400 bg-white mx-auto"
                style={{
                  width: t.chequeWidth * PREVIEW_SCALE,
                  height: t.chequeHeight * PREVIEW_SCALE,
                }}
              >
                {/* Field overlays */}
                {[
                  { key: 'date', value: cheque.date },
                  { key: 'payee', value: cheque.payee },
                  { key: 'amountWords', value: cheque.amountWords },
                  {
                    key: 'amountFigures',
                    value: cheque.amountFigures.toLocaleString('en-KE', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }),
                  },
                ].map(({ key, value }) => {
                  const f = t.fields[key as keyof typeof t.fields];
                  if (!f) return null;
                  return (
                    <div
                      key={key}
                      style={{
                        position: 'absolute',
                        left: f.x * PREVIEW_SCALE,
                        top: f.y * PREVIEW_SCALE,
                        width: f.width * PREVIEW_SCALE,
                        fontFamily: f.fontFamily,
                        fontSize: f.fontSize * PREVIEW_SCALE * 0.38,
                        fontWeight: f.fontWeight,
                        textAlign: f.align,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        color: '#000',
                      }}
                    >
                      {value}
                    </div>
                  );
                })}

                {/* Dimension guides */}
                <div className="absolute inset-0 pointer-events-none">
                  {[25, 50, 75, 100, 125, 150, 175, 200].map((mm) => (
                    <div
                      key={mm}
                      style={{
                        position: 'absolute',
                        left: mm * PREVIEW_SCALE,
                        top: 0,
                        bottom: 0,
                        borderLeft: '1px solid rgba(0,0,0,0.05)',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mt-5 pt-4 border-t grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-400">Payee</p>
              <p className="text-gray-800 font-medium">{cheque.payee}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Date</p>
              <p className="text-gray-800">{cheque.date}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Amount (figures)</p>
              <p className="text-gray-800 font-mono">
                KES {cheque.amountFigures.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Amount (words)</p>
              <p className="text-gray-800 text-xs">{cheque.amountWords}</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100"
          >
            Close
          </button>
          {t && (
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-ncba-teal text-white rounded-lg hover:bg-ncba-dark transition-colors"
            >
              <Printer size={14} />
              Print this cheque
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
