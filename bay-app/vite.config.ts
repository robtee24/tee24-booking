import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: 'src/renderer',
  server: { port: 5173, strictPort: true },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome128',
    rollupOptions: {
      input: {
        home: path.resolve(__dirname, 'src/renderer/home.html'),
        toolbar: path.resolve(__dirname, 'src/renderer/toolbar.html'),
        overlay: path.resolve(__dirname, 'src/renderer/overlay.html'),
      },
    },
  },
});
