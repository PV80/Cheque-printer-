import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../src/platform/api-types';

// The only bridge between the UI and the computer. Everything goes through
// these named calls; the UI has no direct access to Node or the file system.
const api: DesktopApi = {
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (json) => ipcRenderer.invoke('store:save', json),

  savePdf: (hash, bytes) => ipcRenderer.invoke('pdf:save', hash, bytes),
  readPdf: (hash) => ipcRenderer.invoke('pdf:read', hash),
  openPdf: (hash) => ipcRenderer.invoke('pdf:open', hash),

  listPrinters: () => ipcRenderer.invoke('print:list'),
  print: (job) => ipcRenderer.invoke('print:run', job),
  printToPdf: (job) => ipcRenderer.invoke('print:pdf', job),

  saveFile: (req) => ipcRenderer.invoke('file:save', req),
  openJsonFile: () => ipcRenderer.invoke('file:open-json'),

  getInfo: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
};

contextBridge.exposeInMainWorld('api', api);
