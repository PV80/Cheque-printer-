// Contract between the desktop shell (Electron main process) and the UI.
// Types only: imported by both sides, contains no runtime code.

export type LoadStoreResult =
  | { status: 'empty' }
  | { status: 'ok'; json: string; recovered: boolean }
  | { status: 'corrupt'; message: string };

export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export interface PrintJob {
  html: string;
  widthMm: number;
  heightMm: number;
  /** Printer to use. Empty string shows the system print dialog instead. */
  deviceName: string;
}

export interface PrintResult {
  ok: boolean;
  /** Present when ok is false, e.g. "cancelled". */
  reason?: string;
}

export interface SaveFileRequest {
  defaultName: string;
  content: string;
  kind: 'csv' | 'json';
}

export interface AppInfo {
  version: string;
  dataDir: string;
  packaged: boolean;
}

export interface DesktopApi {
  loadStore(): Promise<LoadStoreResult>;
  saveStore(json: string): Promise<void>;

  savePdf(hash: string, bytes: Uint8Array): Promise<void>;
  readPdf(hash: string): Promise<Uint8Array | null>;
  openPdf(hash: string): Promise<boolean>;

  listPrinters(): Promise<PrinterInfo[]>;
  print(job: PrintJob): Promise<PrintResult>;
  /** Renders the same job to a PDF instead of a printer. Used for checks and tests. */
  printToPdf(job: PrintJob): Promise<Uint8Array>;

  saveFile(req: SaveFileRequest): Promise<{ saved: boolean; path?: string }>;
  openJsonFile(): Promise<{ content: string; name: string } | null>;

  getInfo(): Promise<AppInfo>;
  openDataDir(): Promise<void>;
}
