/**
 * Build artifact verification.
 *
 * Usage:
 *   npm run build
 *   npm run artifact:check
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function fail(msg, extra) {
  // eslint-disable-next-line no-console
  console.error(msg);
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.error(extra);
  }
  process.exit(1);
}

async function statOrNull(p) {
  try {
    return await fs.stat(p);
  } catch (_) {
    return null;
  }
}

async function sha256File(p) {
  const buf = await fs.readFile(p);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function stripQueryAndHash(s) {
  const q = s.indexOf('?');
  const h = s.indexOf('#');
  const cut = q === -1 ? h : (h === -1 ? q : Math.min(q, h));
  return cut === -1 ? s : s.slice(0, cut);
}

function shouldCheckUrl(u) {
  if (!u) return false;
  if (u.startsWith('#')) return false;
  if (u.startsWith('data:')) return false;
  if (u.startsWith('mailto:')) return false;
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('//')) return false;
  return true;
}

function extractAssetUrlsFromHtml(html) {
  const urls = new Set();
  const re = /\b(?:src|href)\s*=\s*["']([^"']+)["']/g;
  for (;;) {
    const m = re.exec(html);
    if (!m) break;
    const u = stripQueryAndHash(m[1]);
    if (!shouldCheckUrl(u)) continue;
    urls.add(u);
  }
  return [...urls];
}

async function dirSummary(dir) {
  const st = await fs.stat(dir);
  if (!st.isDirectory()) return { files: 0, bytes: 0 };

  let files = 0;
  let bytes = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile()) {
        files++;
        const s = await fs.stat(p);
        bytes += s.size;
      }
    }
  }
  return { files, bytes };
}

const root = process.cwd();
const dist = path.resolve(root, 'dist');

const distStat = await statOrNull(dist);
if (!distStat || !distStat.isDirectory()) {
  fail('[artifact] dist/ missing. Run `npm run build` first.');
}

const requiredFiles = [
  'index.html',
  'gm_sim.html',
  'gm_emission_sim.html',
  path.join('docs', 'index.html'),
  path.join('smoketest', 'scenarios.json')
];

const requiredDirs = ['data', 'ui', 'docs'];

const missing = [];
for (const f of requiredFiles) {
  const p = path.join(dist, f);
  const st = await statOrNull(p);
  if (!st || !st.isFile()) missing.push(f);
}
for (const d of requiredDirs) {
  const p = path.join(dist, d);
  const st = await statOrNull(p);
  if (!st || !st.isDirectory()) missing.push(`${d}/`);
}

if (missing.length) {
  fail('[artifact] missing required build outputs:', missing);
}

// eslint-disable-next-line no-console
console.log('[artifact] required outputs: OK');

// Checksums for the key entry points.
for (const f of requiredFiles) {
  const p = path.join(dist, f);
  const sum = await sha256File(p);
  // eslint-disable-next-line no-console
  console.log(`[artifact] sha256 ${f}  ${sum}`);
}

// Summaries for copied runtime folders.
for (const d of requiredDirs) {
  const { files, bytes } = await dirSummary(path.join(dist, d));
  // eslint-disable-next-line no-console
  console.log(`[artifact] ${d}/: ${files} files, ${bytes} bytes`);
}

// Basic runtime asset existence check: verify src/href targets in built HTML exist on disk.
const htmlFiles = ['index.html', 'gm_sim.html', 'gm_emission_sim.html', path.join('docs', 'index.html')];
const referencedMissing = [];
for (const f of htmlFiles) {
  const htmlPath = path.join(dist, f);
  const html = await fs.readFile(htmlPath, 'utf8');
  const urls = extractAssetUrlsFromHtml(html);
  for (const u of urls) {
    const rel = u.startsWith('/') ? u.slice(1) : u;
    const target = path.resolve(dist, rel);
    if (!target.startsWith(dist + path.sep) && target !== dist) {
      referencedMissing.push({ from: f, url: u, reason: 'path escapes dist/' });
      continue;
    }
    const st = await statOrNull(target);
    if (!st) referencedMissing.push({ from: f, url: u, reason: 'missing' });
  }
}

if (referencedMissing.length) {
  fail('[artifact] missing runtime assets referenced by built HTML:', referencedMissing);
}

// eslint-disable-next-line no-console
console.log('[artifact] referenced assets: OK');
