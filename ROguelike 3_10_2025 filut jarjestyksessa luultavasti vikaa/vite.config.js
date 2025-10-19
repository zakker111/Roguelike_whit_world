import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Use a relative base so the app works on static hosts and GitHub Pages project sites.
  // This ensures asset URLs like /ui/style.css are rewritten to ./ui/style.css in the built output.
  base: './',
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