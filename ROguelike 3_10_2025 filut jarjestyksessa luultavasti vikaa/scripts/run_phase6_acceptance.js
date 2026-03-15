import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

import { chromium } from 'playwright-chromium';

const PHASE6_SCENARIOS = [
  'gm_seed_reset',
  'gm_boredom_interest',
  'gm_bridge_faction_travel',
  'gm_bridge_markers',
  'gm_bottle_map',
  'gm_survey_cache'
].join(',');

async function httpGetOk(urlStr) {
  const u = new URL(urlStr);

  return await new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        headers: { 'Cache-Control': 'no-store' }
      },
      (res) => {
        const ok = res && typeof res.statusCode === 'number' && res.statusCode >= 200 && res.statusCode < 300;
        res.resume();
        if (ok) resolve();
        else reject(new Error(`HTTP ${res.statusCode}`));
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function waitForHttpOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;

  while (Date.now() < deadline) {
    try {
      await httpGetOk(url);
      return;
    } catch (e) {
      lastErr = e;
    }

    await sleep(150);
  }

  throw lastErr || new Error(`Timed out waiting for ${url}`);
}

async function findFreePort(preferredPort) {
  const tryListen = (port) =>
    new Promise((resolve, reject) => {
      const s = createNetServer();
      s.unref();
      s.once('error', reject);
      s.listen(port, '127.0.0.1', () => {
        const addr = s.address();
        const p = (addr && typeof addr === 'object' && typeof addr.port === 'number') ? addr.port : port;
        s.close(() => resolve(p));
      });
    });

  const base = Number.isFinite(preferredPort) ? preferredPort : 8080;
  for (let p = base; p < base + 20; p++) {
    try {
      return await tryListen(p);
    } catch (e) {
      if (!(e && e.code === 'EADDRINUSE')) throw e;
    }
  }

  return await tryListen(0);
}

async function main() {
  const preferredPort = Number(process.env.PORT || 8080);
  const port = process.env.PORT ? preferredPort : await findFreePort(preferredPort);

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptsDir, '..');

  const base = new URL(`http://127.0.0.1:${port}/index.html`);

  base.searchParams.set('smoketest', '1');
  base.searchParams.set('dev', '1');
  base.searchParams.set('scenarios', PHASE6_SCENARIOS);
  base.searchParams.set('smokecount', '3');
  // Run all scenarios on every run; Phase 6 acceptance is specifically looking for flakiness across runs.
  base.searchParams.set('skipokafter', '0');
  // Prevent auto-run so we can call runSeries() and capture the multi-run summary object.
  base.searchParams.set('autorun', '0');

  const url = base.toString();

  const server = spawn(process.execPath, [path.join(projectRoot, 'server.js')], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) }
  });

  const serverLogs = [];
  const onLog = (buf) => {
    const s = String(buf || '');
    serverLogs.push(s);
    // keep last ~200 lines
    if (serverLogs.length > 200) serverLogs.splice(0, serverLogs.length - 200);
  };
  server.stdout.on('data', onLog);
  server.stderr.on('data', onLog);

  try {
    await waitForHttpOk(`http://127.0.0.1:${port}/index.html`, 30000);

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

      const consoleLines = [];
      page.on('console', (msg) => {
        try {
          consoleLines.push(`[console.${msg.type()}] ${msg.text()}`);
          if (consoleLines.length > 200) consoleLines.splice(0, consoleLines.length - 200);
        } catch (_) {}
      });
      page.on('pageerror', (err) => {
        try {
          consoleLines.push(`[pageerror] ${String(err && err.message ? err.message : err)}`);
          if (consoleLines.length > 200) consoleLines.splice(0, consoleLines.length - 200);
        } catch (_) {}
      });

      await page.goto(url, { waitUntil: 'load', timeout: 60000 });

      await page.waitForFunction(
        () => !!(window.SmokeTest && window.SmokeTest.Run && window.SmokeTest.Run.runSeries && window.GameAPI),
        { timeout: 60000 }
      );

      const series = await page.evaluate(async () => {
        const res = await window.SmokeTest.Run.runSeries(3);
        const passToken = document.getElementById('smoke-pass-token')?.textContent || null;
        const jsonToken = document.getElementById('smoke-json-token')?.textContent || null;
        return { series: res, passToken, jsonToken };
      });

      const { series: seriesRes, passToken, jsonToken } = series || {};

      let jsonParsed = null;
      try {
        if (jsonToken) jsonParsed = JSON.parse(jsonToken);
      } catch (_) {}

      const runs = (seriesRes && Array.isArray(seriesRes.results)) ? seriesRes.results : [];
      const pass = (seriesRes && typeof seriesRes.pass === 'number') ? seriesRes.pass : null;
      const fail = (seriesRes && typeof seriesRes.fail === 'number') ? seriesRes.fail : null;

      const failingRuns = runs
        .map((r, idx) => ({ r, idx }))
        .filter(({ r }) => r && !r.ok);

      const flake = (typeof pass === 'number' && typeof fail === 'number') ? (pass > 0 && fail > 0) : null;

      const failures = failingRuns.map(({ r, idx }) => {
        const steps = Array.isArray(r.steps) ? r.steps : [];
        const hardFails = steps.filter((s) => s && s.ok === false && !s.skipped);
        return {
          run: idx + 1,
          hardFailCount: hardFails.length,
          hardFailMessages: hardFails.map((s) => String(s.msg || ''))
        };
      });

      const report = {
        ok: fail === 0,
        flake,
        passToken,
        runs: { total: runs.length, pass, fail },
        failures,
        lastRunJsonToken: jsonParsed
      };

      process.stdout.write(JSON.stringify(report, null, 2) + '\n');

      if (fail && fail > 0) {
        process.stderr.write('\nRecent browser console output (tail):\n' + consoleLines.join('\n') + '\n');
        process.stderr.write('\nRecent server logs (tail):\n' + serverLogs.join('') + '\n');
      }

      process.exitCode = (fail === 0) ? 0 : 1;
    } finally {
      await browser.close();
    }
  } finally {
    try { server.kill('SIGTERM'); } catch (_) {}
    // Give server a moment to exit cleanly.
    await sleep(200);
  }
}

main().catch((err) => {
  try {
    process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  } catch (_) {}
  process.exitCode = 1;
});
