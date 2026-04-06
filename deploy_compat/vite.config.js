import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Treat index.html as entry; Vite will discover module scripts
      input: 'index.html'
    }
  }
});