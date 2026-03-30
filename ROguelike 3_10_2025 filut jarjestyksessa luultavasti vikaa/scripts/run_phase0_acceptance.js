import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

import { chromium } from 'playwright-chromium';

const TIMEOUTS = {
  httpReadyMs: 60000,
  pageGotoMs: 90000,
  pageReadyMs: 90000,
  serverShutdownMs: 1500
};

function isExited(child) {
  return !!(child && (child.exitCode !== null || child.signalCode !== null));
}

async function waitForExit(child, timeoutMs) {
  if (!child || isExited(child)) return true;

  return await Promise.race([
    new Promise((resolve) => {
      child.once('exit', () => resolve(true));
    }),
    sleep(timeoutMs).then(() => false)
  ]);
}

async function terminateChild(child, timeoutMs) {
  if (!child || isExited(child)) return;

  try {
    child.kill('SIGTERM');
  } catch (_) {
    try {
      child.kill();
    } catch (_) {}
  }

  const exited = await waitForExit(child, timeoutMs);
  if (exited) return;

  try {
    child.kill('SIGKILL');
  } catch (_) {
    try {
      child.kill();
    } catch (_) {}
  }

  await waitForExit(child, 500);
}

// Phase 0 baseline QA gate: broader scenario set + hard failure on boot-time JS errors.
const PHASE0_SCENARIOS = [
  'world',
  'town',
  'dungeon',
  'region',
  'encounters',
  'inventory',
  'overlays',
  // GM baseline readiness checks
  'gm_seed_reset',
  'gm_boredom_interest',
  'gm_bridge_faction_travel',
  'gm_bridge_markers',
  'quest_board_gm_markers',
  'gm_panel_smoke',
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
        const p = addr && typeof addr === 'object' && typeof addr.port === 'number' ? addr.port : port;
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
  base.searchParams.set('scenarios', PHASE0_SCENARIOS);
  base.searchParams.set('smokecount', '2');
  base.searchParams.set('skipokafter', '0');
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
    if (serverLogs.length > 200) serverLogs.splice(0, serverLogs.length - 200);
  };
  server.stdout.on('data', onLog);
  server.stderr.on('data', onLog);

  try {
    await waitForHttpOk(`http://127.0.0.1:${port}/index.html`, TIMEOUTS.httpReadyMs);

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

      const consoleLines = [];
      const consoleErrors = [];
      const pageErrors = [];

      page.on('console', (msg) => {
        try {
          const line = `[console.${msg.type()}] ${msg.text()}`;
          consoleLines.push(line);
          if (consoleLines.length > 200) consoleLines.splice(0, consoleLines.length - 200);
          if (msg.type() === 'error') {
            consoleErrors.push(line);
            if (consoleErrors.length > 50) consoleErrors.splice(0, consoleErrors.length - 50);
          }
        } catch (_) {}
      });

      page.on('pageerror', (err) => {
        try {
          const line = `[pageerror] ${String(err && err.message ? err.message : err)}`;
          pageErrors.push(line);
          if (pageErrors.length > 50) pageErrors.splice(0, pageErrors.length - 50);
        } catch (_) {}
      });

      await page.goto(url, { waitUntil: 'load', timeout: TIMEOUTS.pageGotoMs });

      await page.waitForFunction(
        () => !!(window.SmokeTest && window.SmokeTest.Run && window.SmokeTest.Run.runSeries && window.GameAPI),
        { timeout: TIMEOUTS.pageReadyMs }
      );

      // Boot-time sanity: verify critical transition functions are present.
      const modeFns = await page.evaluate(() => {
        const M = window.Modes;
        return {
          enterEncounter: typeof M?.enterEncounter === 'function',
          openRegionMap: typeof M?.openRegionMap === 'function',
          startRegionEncounter: typeof M?.startRegionEncounter === 'function',
          completeEncounter: typeof M?.completeEncounter === 'function'
        };
      });

      const fnsOk = !!(modeFns && modeFns.enterEncounter && modeFns.openRegionMap && modeFns.startRegionEncounter && modeFns.completeEncounter);

      const series = await page.evaluate(async () => {
        const res = await window.SmokeTest.Run.runSeries(2);
        const passToken = document.getElementById('smoke-pass-token')?.textContent || null;
        const jsonToken = document.getElementById('smoke-json-token')?.textContent || null;
        return { series: res, passToken, jsonToken };
      });

      const { series: seriesRes, passToken, jsonToken } = series || {};

      let jsonParsed = null;
      try {
        if (jsonToken) jsonParsed = JSON.parse(jsonToken);
      } catch (_) {}

      const runs = seriesRes && Array.isArray(seriesRes.results) ? seriesRes.results : [];
      const pass = seriesRes && typeof seriesRes.pass === 'number' ? seriesRes.pass : null;
      const fail = seriesRes && typeof seriesRes.fail === 'number' ? seriesRes.fail : null;

      const failingRuns = runs.map((r, idx) => ({ r, idx })).filter(({ r }) => r && !r.ok);

      const failures = failingRuns.map(({ r, idx }) => {
        const steps = Array.isArray(r.steps) ? r.steps : [];
        const hardFails = steps.filter((s) => s && s.ok === false && !s.skipped);
        return {
          run: idx + 1,
          hardFailCount: hardFails.length,
          hardFailMessages: hardFails.map((s) => String(s.msg || ''))
        };
      });

      const bootOk = fnsOk && pageErrors.length === 0 && consoleErrors.length === 0;

      const report = {
        ok: fail === 0 && bootOk,
        passToken,
        checks: {
          modeFns: modeFns || null,
          modeFnsOk: fnsOk,
          pageErrorCount: pageErrors.length,
          consoleErrorCount: consoleErrors.length
        },
        runs: { total: runs.length, pass, fail },
        failures,
        bootErrors: { pageErrors, consoleErrors },
        lastRunJsonToken: jsonParsed
      };

      process.stdout.write(JSON.stringify(report, null, 2) + '\n');

      if (!report.ok) {
        process.stderr.write('\nRecent browser console output (tail):\n' + consoleLines.join('\n') + '\n');
        process.stderr.write('\nRecent server logs (tail):\n' + serverLogs.join('') + '\n');
      }

      process.exitCode = report.ok ? 0 : 1;
    } finally {
      await browser.close();
    }
  } finally {
    await terminateChild(server, TIMEOUTS.serverShutdownMs);
  }
}

main().catch((err) => {
  try {
    process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  } catch (_) {}
  process.exitCode = 1;
});
