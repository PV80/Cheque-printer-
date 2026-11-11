// Development launcher: starts the Vite dev server, then Electron pointed at it.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

await import('./copy-pdfjs-assets.mjs');
await import('./build-electron.mjs');

const server = await createServer({ root, server: { port: 5173, strictPort: true } });
await server.listen();

const electronPath = require('electron');
const child = spawn(electronPath, ['.'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CHEQUE_PRINTER_DEV_URL: 'http://localhost:5173' },
});

child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
