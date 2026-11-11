import type { DesktopApi } from './api-types';

declare global {
  interface Window {
    api?: DesktopApi;
  }
}

/** True when running inside the desktop app (not opened as a web page). */
export const hasDesktopApi = typeof window !== 'undefined' && !!window.api;

/** The desktop shell: disk, printers and file dialogs. */
export const api: DesktopApi = (typeof window !== 'undefined' ? window.api : undefined) as DesktopApi;
