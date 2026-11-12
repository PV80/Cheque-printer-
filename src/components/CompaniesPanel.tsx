import { useEffect, useState } from 'react';
import { Building2, CheckCircle, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { FORM_LABELS, FORM_TYPES } from '../core/company';
import { deleteCompany, newCompany, saveCompany } from '../core/store';
import type { CompanyProfile } from '../core/types';
import { api } from '../platform/api';
import type { PrinterInfo } from '../platform/api-types';
import { useApp } from '../state/AppContext';
import { CalibrationTool } from './CalibrationTool';
import { SignatureZoneModal } from './SignatureZoneModal';
import { Badge, Button, Field, inputClass } from './ui';

export function CompaniesPanel() {
  const { store, run } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const open = store.companies.find((c) => c.id === openId);
  if (open) return <CompanyEditor key={open.id} company={open} onBack={() => setOpenId(null)} />;

  function create() {
    const id = crypto.randomUUID();
    if (run((s, ctx) => saveCompany(s, ctx, newCompany(id, newName)))) {
      setNewName('');
      setOpenId(id);
    }
  }

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-bold text-gray-800 mb-1">Companies</h2>
      <p className="text-sm text-gray-500 mb-4">
        Each company has its own cheque layout, signature box and printer. Requisitions are matched to a company by its exact name.
      </p>

      <form
        className="flex gap-2 mb-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) create();
        }}
      >
        <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Company name exactly as on its requisitions" data-testid="new-company-name" />
        <Button type="submit" variant="primary" disabled={!newName.trim()} className="shrink-0" data-testid="add-company">
          <Plus size={15} /> Add company
        </Button>
      </form>

      {store.companies.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">No companies yet.</p>
      ) : (
        <ul className="space-y-2">
          {store.companies.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => setOpenId(c.id)}
                className="w-full flex items-center gap-4 bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-left hover:border-ncba-teal transition-colors"
              >
                <span className="w-10 h-10 rounded-lg bg-ncba-light flex items-center justify-center shrink-0">
                  <Building2 size={20} className="text-ncba-teal" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-gray-800 truncate">{c.name}</span>
                  <span className="block text-xs text-gray-500">
                    {c.bankAccount ? `A/C ${c.bankAccount} · ` : ''}
                    {c.printerName || 'printer chosen at print time'}
                  </span>
                </span>
                <Badge tone={Object.keys(c.signatureZones).length ? 'green' : 'amber'}>
                  {Object.keys(c.signatureZones).length ? 'Signature box set' : 'No signature box'}
                </Badge>
                <ChevronRight size={16} className="text-gray-400" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompanyEditor({ company, onBack }: { company: CompanyProfile; onBack: () => void }) {
  const { run, notify } = useApp();
  const [name, setName] = useState(company.name);
  const [bankAccount, setBankAccount] = useState(company.bankAccount ?? '');
  const [aliases, setAliases] = useState(company.aliases);
  const [aliasDraft, setAliasDraft] = useState('');
  const [loadingNote, setLoadingNote] = useState(company.loadingNote);
  const [printerName, setPrinterName] = useState(company.printerName);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [zoneOpen, setZoneOpen] = useState(false);

  useEffect(() => {
    void api.listPrinters().then(setPrinters).catch(() => setPrinters([]));
  }, []);

  function saveDetails() {
    const ok = run((s, ctx) => {
      const latest = s.companies.find((c) => c.id === company.id);
      if (!latest) return s;
      const pending = aliasDraft.trim() ? [...aliases, aliasDraft.trim()] : aliases;
      return saveCompany(s, ctx, { ...latest, name, bankAccount: bankAccount.trim() || undefined, aliases: pending, loadingNote, printerName });
    });
    if (ok) {
      if (aliasDraft.trim()) {
        setAliases((a) => [...a, aliasDraft.trim()]);
        setAliasDraft('');
      }
      notify('success', 'Company details saved.');
    }
  }

  function remove() {
    if (!window.confirm(`Delete ${company.name}? Its cheque layout and signature box will be lost.`)) return;
    if (run((s, ctx) => deleteCompany(s, ctx, company.id))) onBack();
  }

  const printerMissing = printerName !== '' && printers.length > 0 && !printers.some((p) => p.name === printerName);

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="text-sm text-ncba-teal hover:underline">
          ← Companies
        </button>
        <ChevronRight size={14} className="text-gray-400" />
        <span className="text-gray-800 font-semibold">{company.name}</span>
      </div>

      <div className="grid grid-cols-2 gap-5 mb-6">
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-800 text-sm">Details</h3>
          <Field label="Company name" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Bank account (shown to whoever loads the cheques)" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />

          <div>
            <span className="block text-xs font-medium text-gray-600 mb-1">Other spellings of the name on requisitions</span>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {aliases.length === 0 && <span className="text-xs text-gray-400">None</span>}
              {aliases.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 bg-gray-100 rounded-full pl-2.5 pr-1 py-0.5 text-xs text-gray-700">
                  {a}
                  <button onClick={() => setAliases((list) => list.filter((x) => x !== a))} aria-label={`Remove ${a}`} className="text-gray-400 hover:text-red-500">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <input className={inputClass} value={aliasDraft} onChange={(e) => setAliasDraft(e.target.value)} placeholder="Add another spelling, then Save" />
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Printer for this company's cheques</span>
            <select className={inputClass} value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
              <option value="">Ask each time (print window)</option>
              {printerMissing && <option value={printerName}>{printerName} (not connected)</option>}
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName}
                  {p.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
            <span className="block text-xs text-gray-400 mt-1">
              Choosing a printer prints straight to it at the exact cheque size. Test on plain paper first.
            </span>
          </label>

          <Field
            label="Loading instructions (shown before printing)"
            value={loadingNote}
            onChange={(e) => setLoadingNote(e.target.value)}
            placeholder="e.g. Manual tray, face up, top edge in first"
          />

          <div className="flex justify-between pt-1">
            <Button variant="danger" onClick={remove}>
              <Trash2 size={14} /> Delete company
            </Button>
            <Button variant="primary" onClick={saveDetails} data-testid="save-company">
              Save details
            </Button>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3 self-start">
          <h3 className="font-semibold text-gray-800 text-sm">Signature box</h3>
          <p className="text-sm text-gray-600">
            Where the approver signs. Each kind of form has its own box, because the signature sits in a different place
            on each. A requisition only reaches the print queue when something signature-sized is in its box.
          </p>
          <ul className="space-y-1.5" data-testid="zone-list">
            {FORM_TYPES.filter((t) => t !== 'unknown' || company.signatureZones.unknown?.length).map((type) => {
              const zone = company.signatureZones[type]?.length ? company.signatureZones[type] : undefined;
              return (
                <li key={type} data-form={type} data-set={zone ? 'yes' : 'no'} className={`flex items-center gap-2 text-sm ${zone ? 'text-green-700' : 'text-amber-700'}`}>
                  {zone ? <CheckCircle size={15} /> : <span className="w-[15px] text-center">–</span>}
                  {FORM_LABELS[type]}: {zone ? (zone.length === 1 ? 'set' : `${zone.length} boxes set`) : 'not set — these will be held'}
                </li>
              );
            })}
          </ul>
          <Button onClick={() => setZoneOpen(true)} data-testid="open-zone">
            Open a sample to set or change a box…
          </Button>
          <p className="text-xs text-gray-400">
            The check only confirms that a mark is present. It does not recognise whose signature it is.
          </p>
        </section>
      </div>

      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="font-semibold text-gray-800 text-sm mb-3">Cheque layout</h3>
        <CalibrationTool company={company} />
      </section>

      {zoneOpen && <SignatureZoneModal companyId={company.id} onClose={() => setZoneOpen(false)} />}
    </div>
  );
}
