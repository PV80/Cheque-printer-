import { X } from 'lucide-react';
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { formatMoney } from '../core/amount';
import { formatDate } from '../core/dates';
import type { Cheque } from '../core/types';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ncba-teal text-white hover:bg-ncba-dark',
  secondary: 'border border-gray-300 text-gray-700 bg-white hover:bg-gray-50',
  danger: 'border border-red-300 text-red-700 bg-white hover:bg-red-50',
  ghost: 'text-gray-600 hover:bg-gray-100',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
}

export function Button({ variant = 'secondary', small, className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        small ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm'
      } ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

export const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ncba-teal disabled:bg-gray-100';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, className = '', id, ...rest }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  return (
    <div>
      <label htmlFor={inputId} className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      <input id={inputId} aria-describedby={hint ? hintId : undefined} className={`${inputClass} ${className}`} {...rest} />
      {hint && (
        <p id={hintId} className="text-xs text-gray-400 mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}

interface ModalProps {
  title: string;
  onClose?: () => void; // omit to make the dialog impossible to dismiss
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, footer, wide }: ModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`bg-white rounded-xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[92vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="font-semibold text-gray-800">{title}</h2>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
              <X size={20} />
            </button>
          )}
        </div>
        <div className="px-6 py-5 overflow-auto">{children}</div>
        {footer && <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-xl shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

type Tone = 'green' | 'amber' | 'red' | 'gray' | 'blue';

const TONES: Record<Tone, string> = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-blue-100 text-blue-800',
};

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-xl mx-auto py-16 px-4 text-center">
      <div className="mx-auto mb-4 text-gray-300 flex justify-center">{icon}</div>
      <p className="text-gray-600 text-lg">{title}</p>
      {children && <div className="text-sm text-gray-400 mt-1">{children}</div>}
    </div>
  );
}

/** The key facts of a cheque on one line, used in lists and dialogs. */
export function ChequeFacts({ cheque, companyName }: { cheque: Cheque; companyName: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-500 truncate">{companyName}</p>
      <p className="text-sm text-gray-800">
        <span className="font-mono font-semibold">{cheque.chequeNumber || 'no number'}</span>
        <span className="mx-2 text-gray-300">|</span>
        <span className="font-medium">{cheque.payee || 'no payee'}</span>
      </p>
      <p className="text-xs text-gray-600">
        {formatDate(cheque.date) || 'no date'}
        <span className="mx-2 text-gray-300">|</span>
        <span className="font-mono">KES {formatMoney(cheque.amountCents)}</span>
      </p>
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'amber' | 'red' | 'blue' | 'green'; children: ReactNode }) {
  const styles = {
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    red: 'bg-red-50 border-red-200 text-red-900',
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    green: 'bg-green-50 border-green-200 text-green-900',
  }[tone];
  return <div className={`p-3 border rounded-lg text-sm ${styles}`}>{children}</div>;
}
