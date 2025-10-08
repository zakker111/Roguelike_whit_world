/**
 * Simple smoke test runner.
 * - Launches server.js
 * - Probes key endpoints
 * - Validates basic HTML markers
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const BASE = `http://localhost:${PORT}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await httpGet('/');
      return true;
    } catch (_) {
      await wait(200);
    }
  }
  return false;
}

function httpGet(pathname) {
  const url = `${BASE}${pathname}`;
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode || 0, body: buf.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function run() {
  const serverPath = path.join(process.cwd(), 'server.js');
  try {
    fs.accessSync(serverPath, fs.constants.R_OK);
  } catch (e) {
    console.error('[SMOKE] server.js not found or not readable:', e.message || e);
    process.exit(1);
  }

  console.log('[SMOKE] starting dev server...');
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT) },
  });

  let serverOutput = '';
  child.stdout.on('data', (d) => { serverOutput += d.toString(); });
  child.stderr.on('data', (d) => { serverOutput += d.toString(); });

  const started = await waitForServer(8000);
  if (!started) {
    console.error('[SMOKE] server did not start within timeout');
    try { child.kill('SIGTERM'); } catch (_) {}
    process.exit(1);
  }
  console.log('[SMOKE] server is up');

  let failures = 0;

  async function check200(pathname) {
    const r = await httpGet(pathname);
    if (r.status !== 200) {
      console.error(`[SMOKE] FAIL: ${pathname} status=${r.status}`);
      failures++;
      return r;
    }
    console.log(`[SMOKE] OK: ${pathname}`);
    return r;
  }

  // Request index.html with smoketest flag to ensure runner injection path executes
  const idx = await check200('/index.html?smoketest=1');
  if (!idx.body || idx.body.indexOf('<canvas id="game"') === -1) {
    console.error('[SMOKE] FAIL: index.html missing canvas#game');
    failures++;
  }
  if (idx.body.indexOf('id="god-panel"') === -1) {
    console.error('[SMOKE] FAIL: index.html missing GOD panel');
    failures++;
  }

  // Probe a few critical modules that should exist per index.html
  await check200('/ui/ui.js');
  await check200('/core/game.js');
  await check200('/ui/smoketest_runner.js');

  // Optional: log a snippet from server output
  if (serverOutput) {
    const lines = serverOutput.trim().split('\n');
    console.log('[SMOKE] server output (tail):', lines.slice(-3).join('\n'));
  }

  // Cleanup
  try { child.kill('SIGTERM'); } catch (_) {}

  if (failures > 0) {
    console.error(`[SMOKE] completed with ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('[SMOKE] all checks passed');
}

run().catch((e) => {
  console.error('[SMOKE] unhandled error:', e && e.stack || e);
  process.exit(1);
});