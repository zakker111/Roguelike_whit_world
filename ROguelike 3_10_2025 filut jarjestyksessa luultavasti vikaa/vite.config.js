import { defineConfig } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';

async function copyDir(src, dest) {
  let st = null;
  try {
    st = await fs.stat(src);
  } catch (_) {
    return;
  }
  if (!st.isDirectory()) return;

  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(from, to);
    } else if (e.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

async function copyFileIfExists(src, dest) {
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  } catch (_) {
    // ignore
  }
}

function copyStaticRuntimeFiles() {
  return {
    name: 'copy-static-runtime-files',
    apply: 'build',
    async closeBundle() {
      const root = process.cwd();
      const outDir = path.resolve(root, 'dist');

      // These folders are used at runtime via fetch() or static links (not bundled by Vite).
      // - data/: JSON registries loaded via fetch("/data/...")
      // - ui/: raw CSS + image assets referenced via absolute URLs in index.html
      for (const dir of ['data', 'ui']) {
        await copyDir(path.resolve(root, dir), path.join(outDir, dir));
      }

      // Smoke test scenario manifest is fetched at runtime (not imported), so it must exist in dist.
      await copyFileIfExists(
        path.resolve(root, 'smoketest', 'scenarios.json'),
        path.resolve(outDir, 'smoketest', 'scenarios.json')
      );
    }
  };
}

export default defineConfig({
  root: '.',
  server: {
    port: 5173
  },
  plugins: [copyStaticRuntimeFiles()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Multi-page: keep the GM sims buildable/previewable as static pages.
      input: {
        index: 'index.html',
        gm_sim: 'gm_sim.html',
        gm_emission_sim: 'gm_emission_sim.html'
      }
    }
  }
});