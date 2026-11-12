import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { authenticate, hashPassword, passwordProblem, usernameProblem } from '../core/auth';
import { createFirstAdmin, StoreError } from '../core/store';
import { useApp } from '../state/AppContext';
import { Button, Field, Notice } from './ui';

export function LoginScreen() {
  const { store, info } = useApp();
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-100">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-lg border border-gray-200 p-7">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-ncba-dark text-white flex items-center justify-center font-bold">CP</div>
          <div>
            <h1 className="font-semibold text-lg text-gray-800 leading-tight">Cheque Printer</h1>
            <p className="text-xs text-gray-500" data-testid="app-version">
              Runs on this computer only{info?.version ? ` · version ${info.version}` : ''}
            </p>
          </div>
        </div>
        {store.users.length === 0 ? <FirstRun /> : <SignIn />}
      </div>
    </div>
  );
}

function SignIn() {
  const { store, signIn } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const user = await authenticate(store.users, username, password);
    if (user) {
      signIn(user);
      return;
    }
    // A short pause makes guessing passwords slow.
    await new Promise((r) => setTimeout(r, 1500));
    setError('Wrong username or password.');
    setPassword('');
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="off" />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
      {error && <Notice tone="red">{error}</Notice>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy || !username || !password}>
        <Lock size={14} /> {busy ? 'Checking…' : 'Sign in'}
      </Button>
    </form>
  );
}

function FirstRun() {
  const { store, replaceStore, signIn } = useApp();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem =
      (!name.trim() && 'Enter your name.') ||
      usernameProblem(username) ||
      passwordProblem(password) ||
      (password !== confirm && 'The two passwords do not match.');
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const creds = await hashPassword(password);
      const next = createFirstAdmin(
        store,
        { username, displayName: name, role: 'admin', ...creds },
        crypto.randomUUID(),
        new Date().toISOString()
      );
      replaceStore(next);
      signIn(next.users[0]);
    } catch (err) {
      setError(err instanceof StoreError ? err.message : 'Could not create the account.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Notice tone="blue">
        First time here. Create the <strong>administrator</strong> account — the person who approves cheques and manages
        who else can use the app.
      </Notice>
      <Field label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Brian" />
      <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" placeholder="e.g. brian" />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" hint="At least 8 characters. There is no reset by email — keep it safe." />
      <Field label="Password again" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      {error && <Notice tone="red">{error}</Notice>}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? 'Creating…' : 'Create administrator account'}
      </Button>
    </form>
  );
}
