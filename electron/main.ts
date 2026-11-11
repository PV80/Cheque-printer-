import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  AppInfo,
  LoadStoreResult,
  PrinterInfo,
  PrintJob,
  PrintResult,
  SaveFileRequest,
} from '../src/platform/api-types';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DEV_URL = process.env.CHEQUE_PRINTER_DEV_URL ?? '';
const RENDERER_DIR = path.join(__dirname, '..', 'dist');

// Tests point the app at a throwaway folder; normal use keeps data in the
// per-user application data folder.
if (process.env.CHEQUE_PRINTER_DATA_DIR) {
  app.setPath('userData', process.env.CHEQUE_PRINTER_DATA_DIR);
}

const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'data.json');
const backupFile = () => path.join(dataDir(), 'data.json.bak');
const dailyBackupDir = () => path.join(dataDir(), 'backups');
const pdfDir = () => path.join(dataDir(), 'requisitions');

const MAX_STORE_BYTES = 200 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const DAILY_BACKUPS_KEPT = 60;

// ---------------------------------------------------------------------------
// app:// protocol — serves the bundled UI from disk. No web server, no network.
// ---------------------------------------------------------------------------

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'bundle') return new Response('Not found', { status: 404 });

    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(RENDERER_DIR, relative));
    if (file !== RENDERER_DIR && !file.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const body = await fs.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      return new Response(new Uint8Array(body), { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------------------
// Data file: atomic writes, previous-version copy, daily backups.
// ---------------------------------------------------------------------------

async function retryBusy<T>(fn: () => Promise<T>): Promise<T> {
  // Antivirus and indexers on Windows briefly lock files; a short retry clears it.
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
    }
  }
  throw lastError;
}

function parsesAsStore(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as { version?: unknown };
    return typeof parsed === 'object' && parsed !== null && typeof parsed.version === 'number';
  } catch {
    return false;
  }
}

async function loadStore(): Promise<LoadStoreResult> {
  const hasMain = existsSync(dataFile());
  const hasBackup = existsSync(backupFile());
  if (!hasMain && !hasBackup) return { status: 'empty' };

  if (hasMain) {
    try {
      const json = await fs.readFile(dataFile(), 'utf8');
      if (parsesAsStore(json)) return { status: 'ok', json, recovered: false };
    } catch {
      // fall through to the backup copy
    }
  }

  if (hasBackup) {
    try {
      const json = await fs.readFile(backupFile(), 'utf8');
      if (parsesAsStore(json)) return { status: 'ok', json, recovered: true };
    } catch {
      // fall through
    }
  }

  // A data file exists but cannot be read. Never start fresh over it: that
  // would wipe the cheque register on the next save.
  return {
    status: 'corrupt',
    message: `The data file in ${dataDir()} could not be read. Restore a copy from the "backups" folder there.`,
  };
}

async function writeDailyBackup(): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(dailyBackupDir(), `data-${stamp}.json`);
  if (existsSync(target)) return;

  await fs.mkdir(dailyBackupDir(), { recursive: true });
  await fs.copyFile(dataFile(), target);

  const files = (await fs.readdir(dailyBackupDir()))
    .filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  for (const old of files.slice(0, Math.max(0, files.length - DAILY_BACKUPS_KEPT))) {
    await fs.rm(path.join(dailyBackupDir(), old), { force: true });
  }
}

async function writeStore(json: string): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  const tmp = dataFile() + '.tmp';

  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(json, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (existsSync(dataFile())) {
    await writeDailyBackup();
    await retryBusy(() => fs.copyFile(dataFile(), backupFile()));
  }
  await retryBusy(() => fs.rename(tmp, dataFile()));
}

// Saves run strictly one after another so a slow write can never be
// overtaken by a newer one.
let saveChain: Promise<void> = Promise.resolve();

function queueSave(json: string): Promise<void> {
  const next = saveChain.catch(() => undefined).then(() => writeStore(json));
  saveChain = next;
  return next;
}

// ---------------------------------------------------------------------------
// Argument checks for calls coming from the UI.
// ---------------------------------------------------------------------------

function assertHash(hash: unknown): asserts hash is string {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error('Invalid document id');
  }
}

function assertPrintJob(job: unknown): asserts job is PrintJob {
  const j = job as Partial<PrintJob> | null;
  const sizeOk = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 20 && n <= 1000;
  if (
    !j ||
    typeof j.html !== 'string' ||
    j.html.length > MAX_HTML_BYTES ||
    !sizeOk(j.widthMm) ||
    !sizeOk(j.heightMm) ||
    typeof j.deviceName !== 'string' ||
    j.deviceName.length > 300
  ) {
    throw new Error('Invalid print job');
  }
}

// ---------------------------------------------------------------------------
// Printing: the cheque page is loaded in a hidden window and sent to the
// printer at its exact size, with no margins and no scaling.
// ---------------------------------------------------------------------------

const PRINT_PARTITION = 'cheque-print';

async function withPrintWindow<T>(job: PrintJob, run: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const tmpFile = path.join(app.getPath('temp'), `cheque-print-${randomUUID()}.html`);
  await fs.writeFile(tmpFile, job.html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      partition: PRINT_PARTITION,
    },
  });

  try {
    await win.loadURL(pathToFileURL(tmpFile).toString());
    return await run(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await fs.rm(tmpFile, { force: true });
  }
}

function printJob(job: PrintJob): Promise<PrintResult> {
  return withPrintWindow(
    job,
    (win) =>
      new Promise<PrintResult>((resolve) => {
        win.webContents.print(
          {
            silent: job.deviceName !== '',
            deviceName: job.deviceName || undefined,
            printBackground: false,
            margins: { marginType: 'none' },
            pageSize: {
              width: Math.round(job.widthMm * 1000),
              height: Math.round(job.heightMm * 1000),
            },
            copies: 1,
          },
          (success, failureReason) => {
            resolve(success ? { ok: true } : { ok: false, reason: failureReason || 'failed' });
          }
        );
      })
  );
}

function printJobToPdf(job: PrintJob): Promise<Uint8Array> {
  return withPrintWindow(job, async (win) => {
    const buffer = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: { width: job.widthMm / 25.4, height: job.heightMm / 25.4 },
    });
    return new Uint8Array(buffer);
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

function registerIpc(): void {
  ipcMain.handle('store:load', () => loadStore());

  ipcMain.handle('store:save', (_event, json: unknown) => {
    if (typeof json !== 'string' || json.length > MAX_STORE_BYTES || !parsesAsStore(json)) {
      throw new Error('Refusing to save: data is not valid');
    }
    return queueSave(json);
  });

  ipcMain.handle('pdf:save', async (_event, hash: unknown, bytes: unknown) => {
    assertHash(hash);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_PDF_BYTES) {
      throw new Error('Invalid PDF');
    }
    await fs.mkdir(pdfDir(), { recursive: true });
    const target = path.join(pdfDir(), `${hash}.pdf`);
    if (!existsSync(target)) await fs.writeFile(target, bytes);
  });

  ipcMain.handle('pdf:read', async (_event, hash: unknown) => {
    assertHash(hash);
    try {
      return new Uint8Array(await fs.readFile(path.join(pdfDir(), `${hash}.pdf`)));
    } catch {
      return null;
    }
  });

  ipcMain.handle('pdf:open', async (_event, hash: unknown) => {
    assertHash(hash);
    const file = path.join(pdfDir(), `${hash}.pdf`);
    if (!existsSync(file)) return false;
    return (await shell.openPath(file)) === '';
  });

  ipcMain.handle('print:list', async (): Promise<PrinterInfo[]> => {
    if (!mainWindow) return [];
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: Boolean((p as { isDefault?: boolean }).isDefault),
    }));
  });

  let testPrintCount = 0;
  ipcMain.handle('print:run', async (_event, job: unknown): Promise<PrintResult> => {
    assertPrintJob(job);

    // Tests have no printer: they capture the exact page as a PDF instead.
    const testDir = process.env.CHEQUE_PRINTER_E2E_PRINT_DIR;
    if (testDir && !app.isPackaged) {
      const pdf = await printJobToPdf(job);
      await fs.writeFile(path.join(testDir, `print-${++testPrintCount}.pdf`), pdf);
      return { ok: true };
    }
    return printJob(job);
  });

  ipcMain.handle('print:pdf', (_event, job: unknown) => {
    assertPrintJob(job);
    return printJobToPdf(job);
  });

  ipcMain.handle('file:save', async (_event, req: SaveFileRequest) => {
    if (
      !req ||
      typeof req.content !== 'string' ||
      typeof req.defaultName !== 'string' ||
      (req.kind !== 'csv' && req.kind !== 'json')
    ) {
      throw new Error('Invalid save request');
    }
    const safeName = req.defaultName.replace(/[^\w.\- ]+/g, '_');

    // Tests cannot click a native dialog, so they name a folder instead.
    const testDir = process.env.CHEQUE_PRINTER_E2E_SAVE_DIR;
    if (testDir && !app.isPackaged) {
      const target = path.join(testDir, safeName);
      await fs.writeFile(target, req.content, 'utf8');
      return { saved: true, path: target };
    }

    const filters =
      req.kind === 'csv'
        ? [{ name: 'CSV spreadsheet', extensions: ['csv'] }]
        : [{ name: 'Cheque Printer file', extensions: ['json'] }];
    const options = { defaultPath: path.join(app.getPath('documents'), safeName), filters };
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, req.content, 'utf8');
    return { saved: true, path: result.filePath };
  });

  ipcMain.handle('file:open-json', async () => {
    let file = '';
    const testFile = process.env.CHEQUE_PRINTER_E2E_OPEN_FILE;
    if (testFile && !app.isPackaged) {
      file = testFile;
    } else {
      const options = {
        properties: ['openFile' as const],
        filters: [{ name: 'Cheque Printer file', extensions: ['json'] }],
      };
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) return null;
      file = result.filePaths[0];
    }
    const stat = await fs.stat(file);
    if (stat.size > MAX_STORE_BYTES) throw new Error('File is too large');
    return { content: await fs.readFile(file, 'utf8'), name: path.basename(file) };
  });

  ipcMain.handle(
    'app:info',
    (): AppInfo => ({ version: app.getVersion(), dataDir: dataDir(), packaged: app.isPackaged })
  );

  ipcMain.handle('app:open-data-dir', async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    await shell.openPath(dataDir());
  });
}

// ---------------------------------------------------------------------------
// Window + lockdown
// ---------------------------------------------------------------------------

function appUrl(): string {
  return DEV_URL || 'app://bundle/index.html';
}

function isAppOrigin(target: string): boolean {
  try {
    return new URL(target).origin === new URL(appUrl()).origin;
  } catch {
    return false;
  }
}

function lockDownNetwork(): void {
  // The app is fully offline. Any request that is not the bundled UI is cancelled.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowed =
      url.startsWith('app://bundle/') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('devtools:') ||
      (DEV_URL !== '' && (url.startsWith(DEV_URL) || url.startsWith(DEV_URL.replace(/^http/, 'ws'))));
    callback({ cancel: !allowed });
  });

  // The hidden print window may only load its own temporary page.
  session.fromPartition(PRINT_PARTITION).webRequest.onBeforeRequest((details, callback) => {
    const tempPrefix = pathToFileURL(path.join(app.getPath('temp'), 'cheque-print-')).toString();
    callback({ cancel: !details.url.startsWith(tempPrefix) });
  });

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: 'Cheque Printer',
    backgroundColor: '#f9fafb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    mainWindow = null;
  });

  // Dropping a file outside a drop target must never navigate the app away.
  win.webContents.on('will-navigate', (event, target) => {
    if (!isAppOrigin(target)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  void win.loadURL(appUrl());
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  // A second copy would fight the first over the data file.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    if (app.isPackaged) Menu.setApplicationMenu(null);
    registerAppProtocol();
    lockDownNetwork();
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());

  let flushed = false;
  app.on('before-quit', (event) => {
    if (flushed) return;
    // Let any in-flight save finish before the process exits.
    event.preventDefault();
    void saveChain
      .catch(() => undefined)
      .then(() => {
        flushed = true;
        app.quit();
      });
  });
}
