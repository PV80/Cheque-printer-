import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Use repo name as base when deploying to GitHub Pages via Actions
  base: process.env.GITHUB_ACTIONS ? '/Cheque-printer-/' : '/',
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
});
