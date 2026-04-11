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
  seriesRunMs: 120000,
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

function createCleanupController() {
  const cleanupFns = [];
  let cleanupPromise = null;
  let installed = false;
  let removing = false;

  const removeHandlers = () => {
    if (removing || !installed) return;
    removing = true;
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      try { process.removeListener(sig, handlers[sig]); } catch (_) {}
    }
    try { process.removeListener('uncaughtException', handlers.uncaughtException); } catch (_) {}
    try { process.removeListener('unhandledRejection', handlers.unhandledRejection); } catch (_) {}
    installed = false;
    removing = false;
  };

  const runCleanup = async () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const fns = cleanupFns.slice().reverse();
      for (const fn of fns) {
        try {
          await fn();
        } catch (_) {}
      }
      removeHandlers();
    })();
    return cleanupPromise;
  };

  const handlers = {
    SIGINT: () => {
      process.exitCode = process.exitCode || 130;
      runCleanup().finally(() => process.exit(process.exitCode || 130));
    },
    SIGTERM: () => {
      process.exitCode = process.exitCode || 143;
      runCleanup().finally(() => process.exit(process.exitCode || 143));
    },
    SIGHUP: () => {
      process.exitCode = process.exitCode || 129;
      runCleanup().finally(() => process.exit(process.exitCode || 129));
    },
    uncaughtException: (err) => {
      process.exitCode = 1;
      try {
        process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
      } catch (_) {}
      runCleanup().finally(() => process.exit(1));
    },
    unhandledRejection: (err) => {
      process.exitCode = 1;
      try {
        process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
      } catch (_) {}
      runCleanup().finally(() => process.exit(1));
    }
  };

  const installHandlers = () => {
    if (installed) return;
    installed = true;
    process.on('SIGINT', handlers.SIGINT);
    process.on('SIGTERM', handlers.SIGTERM);
    process.on('SIGHUP', handlers.SIGHUP);
    process.on('uncaughtException', handlers.uncaughtException);
    process.on('unhandledRejection', handlers.unhandledRejection);
  };

  return {
    add(fn) {
      if (typeof fn === 'function') cleanupFns.push(fn);
    },
    installHandlers,
    runCleanup,
    removeHandlers
  };
}

async function withTimeout(work, timeoutMs, label) {
  return await Promise.race([
    Promise.resolve().then(() => work()),
    sleep(timeoutMs).then(() => {
      const err = new Error(`${label} timed out after ${timeoutMs}ms`);
      err.code = 'HARNESS_TIMEOUT';
      throw err;
    })
  ]);
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

function parseSeriesRuns(rawValue) {
  const n = Number(rawValue);
  if (!Number.isFinite(n)) return 2;
  return Math.max(2, Math.trunc(n));
}

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

async function waitForHttpOk(url, timeoutMs, shouldAbort = null) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;

  while (Date.now() < deadline) {
    if (typeof shouldAbort === 'function') {
      try {
        if (shouldAbort()) {
          throw new Error(`Aborted waiting for ${url}`);
        }
      } catch (e) {
        throw e;
      }
    }

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
  const cleanup = createCleanupController();
  cleanup.installHandlers();
  const preferredPort = Number(process.env.PORT || 8080);
  const seriesRuns = parseSeriesRuns(process.env.PHASE0_SERIES_RUNS || 2);
  const scenarioCount = PHASE0_SCENARIOS.split(',').length;
  // Phase 0 runs a broad suite with multiple world-mode transitions and browser-settle
  // waits. A healthy single series is already close to 70s in this repo, so two full
  // series need more headroom than a bare per-scenario multiplier leaves. Keep the
  // timeout proportional to suite size, but add fixed slack for page orchestration.
  const seriesRunTimeoutMs = Math.max(TIMEOUTS.seriesRunMs, (seriesRuns * scenarioCount * 8000) + 30000);
  // Some environments set PORT globally (e.g. Codespaces/preview tooling). If that port is already
  // in use, the server child will fail to bind and the harness can accidentally talk to whatever
  // is already listening there (often resulting in redirect loops). Always probe for a free port
  // starting from the preferred value.
  const port = await findFreePort(preferredPort);

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptsDir, '..');

  const base = new URL(`http://127.0.0.1:${port}/index.html`);

  base.searchParams.set('smoketest', '1');
  base.searchParams.set('dev', '1');
  base.searchParams.set('scenarios', PHASE0_SCENARIOS);
  base.searchParams.set('smokecount', String(seriesRuns));
  base.searchParams.set('skipokafter', '0');
  base.searchParams.set('autorun', '0');

  const url = base.toString();

  const server = spawn(process.execPath, [path.join(projectRoot, 'server.js')], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) }
  });
  cleanup.add(() => terminateChild(server, TIMEOUTS.serverShutdownMs));

  const serverLogs = [];
  const onLog = (buf) => {
    const s = String(buf || '');
    serverLogs.push(s);
    if (serverLogs.length > 200) serverLogs.splice(0, serverLogs.length - 200);
  };
  server.stdout.on('data', onLog);
  server.stderr.on('data', onLog);

  try {
    await waitForHttpOk(`http://127.0.0.1:${port}/index.html`, TIMEOUTS.httpReadyMs, () => isExited(server));

    if (isExited(server)) {
      throw new Error('Server exited before becoming ready');
    }

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    cleanup.add(() => withTimeout(() => browser.close(), 5000, 'browser.close').catch(() => {}));
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

      await page.evaluate((runs) => {
        window.__PHASE0_SERIES_RUNS__ = runs;
      }, seriesRuns);

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

      const series = await withTimeout(
        () =>
          page.evaluate(async () => {
            const seriesRuns = Number(window.__PHASE0_SERIES_RUNS__ || 2);
            window.SmokeTest = window.SmokeTest || {};
            window.SmokeTest.Runner = window.SmokeTest.Runner || {};
            window.SmokeTest.Runner.COLLECT_ONLY = true;
            const res = await window.SmokeTest.Run.runSeries(seriesRuns);
            const passToken = document.getElementById('smoke-pass-token')?.textContent || null;
            const jsonToken = document.getElementById('smoke-json-token')?.textContent || null;
            return { series: res, passToken, jsonToken };
          }),
        seriesRunTimeoutMs,
        `SmokeTest.Run.runSeries(${seriesRuns})`
      );

      const { series: seriesRes, passToken, jsonToken } = series || {};

      let jsonParsed = null;
      try {
        if (jsonToken) jsonParsed = JSON.parse(jsonToken);
      } catch (_) {}

      const runs = seriesRes && Array.isArray(seriesRes.results) ? seriesRes.results : [];
      const pass = seriesRes && typeof seriesRes.pass === 'number' ? seriesRes.pass : null;
      const fail = seriesRes && typeof seriesRes.fail === 'number' ? seriesRes.fail : null;
      const flakeScenarios = (seriesRes && Array.isArray(seriesRes.flakeScenarios)) ? seriesRes.flakeScenarios : [];
      const normalizedFlakeScenarios = (seriesRes && Array.isArray(seriesRes.normalizedFlakeScenarios)) ? seriesRes.normalizedFlakeScenarios : [];
      const scenarioOutcomes = (seriesRes && seriesRes.scenarioOutcomes && typeof seriesRes.scenarioOutcomes === 'object') ? seriesRes.scenarioOutcomes : {};
      const seriesOk = (seriesRes && typeof seriesRes.seriesOk === 'boolean')
        ? seriesRes.seriesOk
        : (fail === 0 && flakeScenarios.length === 0);

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
        ok: seriesOk && bootOk,
        config: {
          seriesRuns,
          scenarioCount
        },
        passToken,
        checks: {
          modeFns: modeFns || null,
          modeFnsOk: fnsOk,
          pageErrorCount: pageErrors.length,
          consoleErrorCount: consoleErrors.length
        },
        runs: { total: runs.length, pass, fail },
        flake: flakeScenarios.length > 0,
        flakeScenarios,
        normalizedFlakeScenarios,
        scenarioOutcomes,
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
      await cleanup.runCleanup();
    }
  } finally {
    await cleanup.runCleanup();
  }
}

main().catch((err) => {
  try {
    process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  } catch (_) {}
  process.exitCode = 1;
});
