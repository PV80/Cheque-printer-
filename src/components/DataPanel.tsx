import { useState } from 'react';
import { Download, FolderOpen, Upload } from 'lucide-react';
import { todayIso } from '../core/dates';
import { importCompanyLayouts, logEvent, parseStore, serializeStore, StoreError, updateSettings } from '../core/store';
import { api } from '../platform/api';
import { useApp } from '../state/AppContext';
import { Button, Notice } from './ui';

const LAYOUT_FILE_TYPE = 'cheque-printer-layouts';

export function DataPanel() {
  const { store, user, info, run, replaceStore, signOut, notify } = useApp();
  const [minutes, setMinutes] = useState(String(store.settings.autoLockMinutes));

  async function exportLayouts() {
    const content = JSON.stringify({ type: LAYOUT_FILE_TYPE, version: 1, companies: store.companies }, null, 2);
    const result = await api.saveFile({ defaultName: `cheque-layouts-${todayIso()}.json`, content, kind: 'json' });
    if (result.saved) notify('success', `Layouts saved to ${result.path}`);
  }

  async function importLayouts() {
    const file = await api.openJsonFile();
    if (!file) return;
    let companies: unknown;
    try {
      const parsed = JSON.parse(file.content) as unknown;
      // Accepts this app's export, a full backup, or the list saved by the old web version.
      companies = Array.isArray(parsed) ? parsed : (parsed as { companies?: unknown }).companies;
    } catch {
      companies = null;
    }
    if (!Array.isArray(companies)) return notify('error', `${file.name} does not contain cheque layouts.`);

    const list = companies;
    let summary = '';
    const ok = run((s, ctx) => {
      const result = importCompanyLayouts(s, ctx, list);
      summary = `${result.added} added, ${result.updated} updated${result.skipped.length ? `, ${result.skipped.length} skipped (${result.skipped.join('; ')})` : ''}.`;
      return result.store;
    });
    if (ok) notify('success', `Layouts imported: ${summary}`);
  }

  async function exportBackup() {
    const result = await api.saveFile({ defaultName: `cheque-printer-backup-${todayIso()}.json`, content: serializeStore(store), kind: 'json' });
    if (result.saved) {
      run((s, ctx) => logEvent(s, ctx, 'Exported backup', result.path ?? ''));
      notify('success', `Backup saved to ${result.path}`);
    }
  }

  async function restoreBackup() {
    if (!user) return;
    const file = await api.openJsonFile();
    if (!file) return;
    try {
      const restored = parseStore(file.content);
      if (!restored.users.some((u) => u.role === 'admin' && u.active)) {
        return notify('error', 'That backup has no administrator account, so it cannot be restored.');
      }
      const message =
        `Replace ALL current data with ${file.name}?\n\n` +
        `It holds ${restored.cheques.length} cheque records, ${restored.companies.length} companies and ${restored.users.length} users.\n` +
        'Everything entered since that backup was made will be lost, and everyone will be signed out.';
      if (!window.confirm(message)) return;
      const ctx = { actor: user, now: new Date().toISOString(), newId: () => crypto.randomUUID() };
      replaceStore(logEvent(restored, ctx, 'Restored backup', file.name));
      signOut();
    } catch (err) {
      notify('error', err instanceof StoreError ? err.message : 'That file could not be read.');
    }
  }

  function saveMinutes() {
    const n = Number(minutes);
    if (!Number.isFinite(n) || n < 0) return notify('error', 'Enter a number of minutes, or 0 to switch it off.');
    if (run((s, ctx) => updateSettings(s, ctx, { autoLockMinutes: n }))) notify('success', 'Saved.');
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-800 mb-1">Data and backup</h2>
        <p className="text-sm text-gray-500">Everything is stored on this computer. Nothing is sent over the internet.</p>
      </div>

      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">Where the data lives</h3>
        <p className="text-sm text-gray-600 font-mono break-all">{info?.dataDir ?? '…'}</p>
        <p className="text-xs text-gray-500">
          Holds the register (data.json), a copy of every requisition PDF, and an automatic daily backup for the last 60 days.
          For a complete safety copy, copy this whole folder to a USB drive or network share.
        </p>
        <Button onClick={() => void api.openDataDir()}>
          <FolderOpen size={14} /> Open folder
        </Button>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">Cheque layouts</h3>
        <p className="text-sm text-gray-600">Save every company's layout, signature box and printer settings to a file, or load them on another computer.</p>
        <div className="flex gap-2">
          <Button onClick={() => void exportLayouts()} data-testid="export-layouts">
            <Download size={14} /> Export layouts
          </Button>
          <Button onClick={() => void importLayouts()} data-testid="import-layouts">
            <Upload size={14} /> Import layouts
          </Button>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">Full backup</h3>
        <p className="text-sm text-gray-600">The whole register, companies and user accounts in one file. Requisition PDFs are not included — they stay in the data folder.</p>
        <div className="flex gap-2">
          <Button onClick={() => void exportBackup()}>
            <Download size={14} /> Save a backup file
          </Button>
          <Button variant="danger" onClick={() => void restoreBackup()}>
            <Upload size={14} /> Restore from a backup file
          </Button>
        </div>
        <Notice tone="amber">Restoring replaces everything, including the list of cheques already printed. Only do it to recover from a problem.</Notice>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">Sign out automatically</h3>
        <div className="flex items-center gap-2 text-sm text-gray-700">
          After
          <input className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" type="number" min={0} max={240} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes before automatic sign-out" />
          minutes without activity (0 = never)
          <Button small onClick={saveMinutes}>
            Save
          </Button>
        </div>
      </section>

      <p className="text-xs text-gray-400">Cheque Printer {info?.version ?? ''}</p>
    </div>
  );
}
