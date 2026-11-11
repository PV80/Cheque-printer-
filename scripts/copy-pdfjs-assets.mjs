// Copies the pdf.js standard fonts into public/ so PDFs that do not embed
// their fonts still render with correct metrics, fully offline.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'node_modules/pdfjs-dist/standard_fonts');
const to = resolve(root, 'public/pdfjs/standard_fonts');

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('Copied pdf.js standard fonts to public/pdfjs/standard_fonts');
