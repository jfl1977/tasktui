import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = 'http://127.0.0.1:' + (process.env.TASKTUI_PORT || 8765);

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: { outDir: '../../dist/public', emptyOutDir: true, target: 'es2022' },
  server: { port: 5173, proxy: { '/api': api, '/attachments': api } },
});
