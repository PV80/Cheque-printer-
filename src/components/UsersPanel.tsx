import { useState, type FormEvent } from 'react';
import { KeyRound, UserPlus } from 'lucide-react';
import { hashPassword, passwordProblem, ROLE_LABELS, ROLE_SUMMARY, usernameProblem, verifyPassword } from '../core/auth';
import { addUser, changeOwnPassword, updateUser } from '../core/store';
import type { Role, User } from '../core/types';
import { useApp } from '../state/AppContext';
import { Badge, Button, Field, inputClass, Modal, Notice } from './ui';

const ROLES: Role[] = ['operator', 'supervisor', 'admin'];

export function UsersPanel() {
  const { store, user, run, notify } = useApp();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);
  const [changingOwn, setChangingOwn] = useState(false);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-gray-800">People</h2>
        <div className="flex gap-2">
          <Button onClick={() => setChangingOwn(true)}>
            <KeyRound size={14} /> Change my password
          </Button>
          <Button variant="primary" onClick={() => setAdding(true)} data-testid="add-user">
            <UserPlus size={15} /> Add person
          </Button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-4">Everyone signs in as themselves, so the register shows who did what.</p>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {ROLES.map((r) => (
          <div key={r} className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-sm font-semibold text-gray-800">{ROLE_LABELS[r]}</p>
            <p className="text-xs text-gray-500 mt-1">{ROLE_SUMMARY[r]}</p>
          </div>
        ))}
      </div>

      <table className="w-full text-sm bg-white border border-gray-200 rounded-xl overflow-hidden">
        <thead>
          <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Username</th>
            <th className="px-4 py-2 w-44">Role</th>
            <th className="px-4 py-2 w-56"></th>
          </tr>
        </thead>
        <tbody>
          {store.users.map((u) => (
            <tr key={u.id} className="border-b border-gray-50 last:border-0" data-user={u.username}>
              <td className="px-4 py-3 text-gray-800">
                {u.displayName} {u.id === user?.id && <Badge tone="blue">you</Badge>} {!u.active && <Badge tone="gray">deactivated</Badge>}
              </td>
              <td className="px-4 py-3 font-mono text-gray-600">{u.username}</td>
              <td className="px-4 py-3">
                <select
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                  value={u.role}
                  onChange={(e) => run((s, ctx) => updateUser(s, ctx, u.id, { role: e.target.value as Role }))}
                  aria-label={`Role of ${u.displayName}`}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <Button small onClick={() => setResetting(u)}>
                    Reset password
                  </Button>
                  <Button small variant={u.active ? 'danger' : 'secondary'} onClick={() => run((s, ctx) => updateUser(s, ctx, u.id, { active: !u.active }))}>
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {adding && <AddUserModal onClose={() => setAdding(false)} />}
      {resetting && (
        <PasswordModal
          title={`New password for ${resetting.displayName}`}
          onClose={() => setResetting(null)}
          onSave={async (password) => {
            const creds = await hashPassword(password);
            const ok = run((s, ctx) => updateUser(s, ctx, resetting.id, creds));
            if (ok) notify('success', `Password reset for ${resetting.displayName}.`);
            return ok;
          }}
        />
      )}
      {changingOwn && user && (
        <PasswordModal
          title="Change my password"
          askCurrent
          onClose={() => setChangingOwn(false)}
          onSave={async (password, current) => {
            const me = store.users.find((u) => u.id === user.id);
            if (!me || !(await verifyPassword(current, me.salt, me.hash))) return 'Your current password is wrong.';
            const creds = await hashPassword(password);
            const ok = run((s, ctx) => changeOwnPassword(s, ctx, creds.salt, creds.hash));
            if (ok) notify('success', 'Your password has been changed.');
            return ok;
          }}
        />
      )}
    </div>
  );
}

function AddUserModal({ onClose }: { onClose: () => void }) {
  const { run, notify } = useApp();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('operator');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = (!displayName.trim() && "Enter the person's name.") || usernameProblem(username) || passwordProblem(password);
    if (problem) return setError(problem);
    setBusy(true);
    const creds = await hashPassword(password);
    setBusy(false);
    if (run((s, ctx) => addUser(s, ctx, { username, displayName, role, ...creds }))) {
      notify('success', `${displayName.trim()} can now sign in as "${username.trim().toLowerCase()}".`);
      onClose();
    }
  }

  return (
    <Modal title="Add a person" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
        <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Role</span>
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="new-user-role">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]} — {ROLE_SUMMARY[r]}
              </option>
            ))}
          </select>
        </label>
        <Field label="Starting password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" hint="At least 8 characters. They can change it after signing in." />
        {error && <Notice tone="red">{error}</Notice>}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy} data-testid="create-user">
            Add person
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface PasswordModalProps {
  title: string;
  askCurrent?: boolean;
  onClose: () => void;
  /** Returns true when saved, false when refused, or a message to show. */
  onSave: (password: string, current: string) => Promise<boolean | string>;
}

function PasswordModal({ title, askCurrent, onClose, onSave }: PasswordModalProps) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password) || (password !== confirm && 'The two passwords do not match.');
    if (problem) return setError(problem);
    setBusy(true);
    const result = await onSave(password, current);
    setBusy(false);
    if (result === true) onClose();
    else if (typeof result === 'string') setError(result);
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {askCurrent && <Field label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus autoComplete="off" />}
        <Field label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={!askCurrent} autoComplete="new-password" />
        <Field label="New password again" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        {error && <Notice tone="red">{error}</Notice>}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Save password
          </Button>
        </div>
      </form>
    </Modal>
  );
}
