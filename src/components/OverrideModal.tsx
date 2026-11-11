import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { authenticate, can } from '../core/auth';
import { addOverride } from '../core/store';
import type { Cheque, OverrideKind } from '../core/types';
import { useApp } from '../state/AppContext';
import { Button, ChequeFacts, Field, inputClass, Modal, Notice } from './ui';

interface Props {
  cheque: Cheque;
  kind: OverrideKind;
  message: string;
  onClose: () => void;
}

const TITLES: Record<OverrideKind, string> = {
  unsigned: 'Release without a signature',
  duplicate_payment: 'Release a possible double payment',
};

export function OverrideModal({ cheque, kind, message, onClose }: Props) {
  const { store, user, run } = useApp();
  const [reason, setReason] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Someone without the permission needs a supervisor to sign it off here.
  const needsApprover = !can(user, 'override');
  const company = store.companies.find((c) => c.id === cheque.companyId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user || busy) return;
    if (reason.trim().length < 5) return setError('Give a reason for the override.');

    let approver = user;
    if (needsApprover) {
      setBusy(true);
      const found = await authenticate(store.users, username, password);
      setBusy(false);
      if (!found) return setError('Wrong supervisor username or password.');
      if (!can(found, 'override')) return setError(`${found.displayName} is not allowed to override.`);
      approver = found;
    }

    const ok = run((s, ctx) => addOverride(s, ctx, cheque.id, kind, reason, user.displayName), approver);
    if (ok) onClose();
  }

  return (
    <Modal title={TITLES[kind]} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="border border-gray-200 rounded-lg p-3">
          <ChequeFacts cheque={cheque} companyName={company?.name ?? cheque.companyRaw} />
        </div>
        <Notice tone="amber">{message}</Notice>

        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Reason (kept in the register)</span>
          <textarea
            className={`${inputClass} resize-none`}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Approved by phone, signed copy to follow"
            autoFocus
            data-testid="override-reason"
          />
        </label>

        {needsApprover && (
          <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50">
            <p className="text-xs text-gray-600">
              You are not allowed to override. A supervisor or administrator must enter their own sign-in here.
            </p>
            <Field label="Supervisor username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            <Field label="Supervisor password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
          </div>
        )}

        {error && <Notice tone="red">{error}</Notice>}

        <div className="flex justify-end gap-3 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy} data-testid="override-submit">
            <ShieldCheck size={14} /> {busy ? 'Checking…' : 'Override and release'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
