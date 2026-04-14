export function filterRunStepsForDisplay(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const sawTownOkRun = list.some(s => s && s.ok && (/entered town/i.test(String(s.msg || "")) || /mode confirm\s*\(town enter\):\s*town/i.test(String(s.msg || ""))));
  const sawDungeonOkRun = list.some(s => s && s.ok && /entered dungeon/i.test(String(s.msg || "")));
  const sawCombatOkRun = list.some(s => s && s.ok && !s.skipped && (
    (s.scenario && s.scenario === "combat") ||
    /moved and attempted attacks|combat effects:|killed enemy|attacked enemy/i.test(String(s.msg || ""))
  ));

  const shouldSuppressMsg = (msg) => {
    const t = String(msg || "");
    if (sawTownOkRun) {
      if (/town entry not achieved/i.test(t)) return true;
      if (/town overlays skipped/i.test(t)) return true;
      if (/town diagnostics skipped/i.test(t)) return true;
      if (/mode confirm\s*\(town (re-)?enter\):\s*world/i.test(t)) return true;
    }
    if (sawDungeonOkRun) {
      if (/dungeon entry failed/i.test(t)) return true;
      if (/mode confirm\s*\(dungeon (re-)?enter\):\s*world/i.test(t)) return true;
    }
    if (sawCombatOkRun) {
      if (/combat scenario skipped\s*\(not in dungeon\)/i.test(t)) return true;
    }
    return false;
  };

  return list.filter(s => !shouldSuppressMsg(s && s.msg));
}

export function buildScenarioOutcomes(allResults) {
  const out = {};
  try {
    for (const res of Array.isArray(allResults) ? allResults : []) {
      if (!res || !Array.isArray(res.scenarioResults)) continue;
      for (const sr of res.scenarioResults) {
        if (!sr || !sr.name) continue;
        const name = String(sr.name);
        if (!out[name]) {
          out[name] = {
            runs: 0,
            passRuns: 0,
            failRuns: 0,
            rawPassRuns: 0,
            rawFailRuns: 0,
            heuristicPassRuns: 0,
            skippedStableRuns: 0,
            skippedMissingRuns: 0,
            hardFailMessages: []
          };
        }
        const cur = out[name];
        cur.runs += 1;
        if (sr.skippedStable) {
          cur.skippedStableRuns += 1;
          continue;
        }
        if (sr.skippedMissing) {
          cur.skippedMissingRuns += 1;
          continue;
        }
        if (sr.rawPassed) cur.rawPassRuns += 1;
        else cur.rawFailRuns += 1;
        if (sr.passed) cur.passRuns += 1;
        else cur.failRuns += 1;
        if (sr.normalizedByHeuristic) cur.heuristicPassRuns += 1;
        const msgs = Array.isArray(sr.hardFailMessages) ? sr.hardFailMessages : [];
        for (const msg of msgs) {
          if (cur.hardFailMessages.indexOf(msg) === -1) cur.hardFailMessages.push(msg);
        }
      }
    }
    Object.keys(out).forEach((name) => {
      const cur = out[name];
      if (!cur) return;
      cur.executedRuns = Math.max(0, (cur.runs | 0) - (cur.skippedStableRuns | 0) - (cur.skippedMissingRuns | 0));
    });
  } catch (_) {}
  return out;
}

export function buildFlakeSummaries(scenarioOutcomes) {
  const outcomes = scenarioOutcomes && typeof scenarioOutcomes === "object" ? scenarioOutcomes : {};
  const normalizedFlakeScenarios = Object.entries(outcomes)
    .filter(([, outcome]) => outcome && outcome.passRuns > 0 && outcome.failRuns > 0)
    .map(([name, outcome]) => ({ name, ...outcome }));
  const rawFlakeScenarios = Object.entries(outcomes)
    .filter(([, outcome]) => outcome && outcome.rawPassRuns > 0 && outcome.rawFailRuns > 0)
    .map(([name, outcome]) => ({ name, ...outcome }));
  return {
    normalizedFlakeScenarios,
    rawFlakeScenarios,
    flakeScenarios: rawFlakeScenarios,
    flake: rawFlakeScenarios.length > 0
  };
}

export function buildAggregatedStepsForDisplay(aggValues) {
  const aggregatedSteps = Array.from(Array.isArray(aggValues) ? aggValues : []).map(v => {
    return { ok: !!v.ok, msg: v.msg, skipped: (!v.ok && !!v.skippedAny) };
  });
  return filterRunStepsForDisplay(aggregatedSteps);
}

export function summarizeStepPerf(allResults) {
  let stepAvgTurn = 0;
  let stepAvgDraw = 0;
  try {
    const allSteps = [];
    for (const res of Array.isArray(allResults) ? allResults : []) {
      if (res && Array.isArray(res.steps)) {
        for (const s of res.steps) {
          if (s && s.perf) allSteps.push(s.perf);
        }
      }
    }
    if (allSteps.length) {
      let sumT = 0;
      let sumD = 0;
      for (const p of allSteps) {
        sumT += Number(p.turn || 0);
        sumD += Number(p.draw || 0);
      }
      stepAvgTurn = sumT / allSteps.length;
      stepAvgDraw = sumD / allSteps.length;
    }
  } catch (_) {}
  return { stepAvgTurn, stepAvgDraw };
}

export function buildPerfWarnings(stepAvgTurn, stepAvgDraw, perfBudget) {
  const warnings = [];
  try {
    if (stepAvgTurn > perfBudget.turnMs) warnings.push(`Avg per-step turn ${stepAvgTurn.toFixed ? stepAvgTurn.toFixed(2) : stepAvgTurn}ms exceeds budget ${perfBudget.turnMs}ms`);
    if (stepAvgDraw > perfBudget.drawMs) warnings.push(`Avg per-step draw ${stepAvgDraw.toFixed ? stepAvgDraw.toFixed(2) : stepAvgDraw}ms exceeds budget ${perfBudget.drawMs}ms`);
  } catch (_) {}
  return warnings;
}

export function buildSeriesSummaryHtml({ runs, pass, fail, skippedRuns, skippedAggCount, seriesOk, flakeScenarios, normalizedFlakeScenarios, stepAvgTurn, stepAvgDraw, perfWarnings }) {
  const failColorSum = fail ? '#ef4444' : '#86efac';
  const flakeColor = flakeScenarios.length ? '#f59e0b' : '#86efac';
  const normalizedFlakeColor = normalizedFlakeScenarios.length ? '#f59e0b' : '#86efac';
  return [
    `<div style="margin-top:8px;"><strong>Smoke Test Summary:</strong></div>`,
    `<div>Runs: ${runs}  Pass: ${pass}  Fail: <span style="color:${failColorSum};">${fail}</span>  Skipped runs: ${skippedRuns}  •  Step skips: ${skippedAggCount}</div>`,
    `<div>Series status: <span style="color:${seriesOk ? '#86efac' : '#ef4444'};">${seriesOk ? 'PASS' : 'FAIL'}</span>  •  Raw flaky scenarios: <span style="color:${flakeColor};">${flakeScenarios.length}</span>  •  Normalized flaky scenarios: <span style="color:${normalizedFlakeColor};">${normalizedFlakeScenarios.length}</span></div>`,
    `<div style="opacity:0.9;">Avg PERF (per-step): turn ${stepAvgTurn.toFixed ? stepAvgTurn.toFixed(2) : stepAvgTurn} ms, draw ${stepAvgDraw.toFixed ? stepAvgDraw.toFixed(2) : stepAvgDraw} ms</div>`,
    perfWarnings.length ? `<div style="color:#ef4444; margin-top:4px;"><strong>Performance:</strong> ${perfWarnings.join("; ")}</div>` : ``,
  ].join("");
}

export function buildDiagnostics(aggregatedSteps) {
  try {
    const list = Array.isArray(aggregatedSteps) ? aggregatedSteps : [];
    const imm = list.filter(s => !s.ok && !s.skipped && /immobile/i.test(String(s.msg || ""))).length;
    const dead = list.filter(s => !s.ok && !s.skipped && /(death|dead|game over)/i.test(String(s.msg || ""))).length;
    return { immobileFailures: imm, deathFailures: dead };
  } catch (_) {
    return { immobileFailures: 0, deathFailures: 0 };
  }
}

export function buildScenarioPassCountsObject(scenarioPassCounts) {
  const obj = {};
  try {
    scenarioPassCounts.forEach((v, k) => { obj[k] = v | 0; });
  } catch (_) {}
  return obj;
}

export function buildActionsSummary(allResults) {
  const sum = {};
  try {
    for (const res of Array.isArray(allResults) ? allResults : []) {
      if (!res || !res.trace || !Array.isArray(res.trace.actions)) continue;
      for (const act of res.trace.actions) {
        const t = String((act && act.type) || "");
        if (!t) continue;
        if (!sum[t]) sum[t] = { count: 0, success: 0 };
        sum[t].count += 1;
        if (act && act.success) sum[t].success += 1;
      }
    }
  } catch (_) {}
  return sum;
}

export function buildScenariosSummary(allResults) {
  const m = {};
  try {
    for (const res of Array.isArray(allResults) ? allResults : []) {
      if (!res || !res.trace || !Array.isArray(res.trace.scenarioTraces)) continue;
      const passMap = {};
      try {
        if (Array.isArray(res.scenarioResults)) {
          for (const sr of res.scenarioResults) {
            if (sr && sr.name) passMap[sr.name] = !!sr.passed;
          }
        }
      } catch (_) {}
      for (const st of res.trace.scenarioTraces) {
        if (!st || !st.name) continue;
        const name = st.name;
        const dur = Math.max(0, st.durationMs | 0);
        const prev = m[name] || { runs: 0, passed: 0, sumDurationMs: 0, minDurationMs: null, maxDurationMs: null };
        prev.runs += 1;
        if (passMap[name]) prev.passed += 1;
        prev.sumDurationMs += dur;
        prev.minDurationMs = (prev.minDurationMs == null) ? dur : Math.min(prev.minDurationMs, dur);
        prev.maxDurationMs = (prev.maxDurationMs == null) ? dur : Math.max(prev.maxDurationMs, dur);
        m[name] = prev;
      }
    }
    Object.keys(m).forEach(k => {
      const v = m[k];
      v.avgDurationMs = v.runs ? (v.sumDurationMs / v.runs) : 0;
      delete v.sumDurationMs;
    });
  } catch (_) {}
  return m;
}

export function buildAllStepStats(allResults) {
  const allSteps = [];
  try {
    for (const res of Array.isArray(allResults) ? allResults : []) {
      if (res && Array.isArray(res.steps)) allSteps.push.apply(allSteps, res.steps);
    }
  } catch (_) {}

  const stepTileStats = (() => {
    const out = { TOWN: 0, DUNGEON: 0, walkable: 0, blocked: 0, unknown: 0 };
    try {
      for (const s of allSteps) {
        const t = String((s && s.tile) || "(unknown)");
        if (t === "TOWN") out.TOWN += 1;
        else if (t === "DUNGEON") out.DUNGEON += 1;
        else if (t === "walkable") out.walkable += 1;
        else if (t === "blocked") out.blocked += 1;
        else out.unknown += 1;
      }
    } catch (_) {}
    return out;
  })();

  const stepModalStats = (() => {
    const out = { samples: 0, god: 0, inventory: 0, loot: 0, shop: 0, smoke: 0 };
    try {
      for (const s of allSteps) {
        if (!s || !s.modals) continue;
        out.samples += 1;
        if (s.modals.god === true) out.god += 1;
        if (s.modals.inventory === true) out.inventory += 1;
        if (s.modals.loot === true) out.loot += 1;
        if (s.modals.shop === true) out.shop += 1;
        if (s.modals.smoke === true) out.smoke += 1;
      }
    } catch (_) {}
    return out;
  })();

  const stepPerfStats = (() => {
    const out = { count: 0, avgTurnMs: 0, avgDrawMs: 0, minTurnMs: null, maxTurnMs: null, minDrawMs: null, maxDrawMs: null };
    try {
      let sumTurn = 0, sumDraw = 0;
      for (const s of allSteps) {
        if (!s || !s.perf) continue;
        const t = Number(s.perf.turn || 0);
        const d = Number(s.perf.draw || 0);
        sumTurn += t;
        sumDraw += d;
        out.count += 1;
        out.minTurnMs = (out.minTurnMs == null) ? t : Math.min(out.minTurnMs, t);
        out.maxTurnMs = (out.maxTurnMs == null) ? t : Math.max(out.maxTurnMs, t);
        out.minDrawMs = (out.minDrawMs == null) ? d : Math.min(out.minDrawMs, d);
        out.maxDrawMs = (out.maxDrawMs == null) ? d : Math.max(out.maxDrawMs, d);
      }
      out.avgTurnMs = out.count ? (sumTurn / out.count) : 0;
      out.avgDrawMs = out.count ? (sumDraw / out.count) : 0;
    } catch (_) {}
    return out;
  })();

  return { stepTileStats, stepModalStats, stepPerfStats };
}

export function buildAggregatedExportReport({
  runnerVersion,
  runs,
  pass,
  fail,
  seriesOk,
  flake,
  flakeScenarios,
  normalizedFlakeScenarios,
  scenarioOutcomes,
  hardFailRuns,
  skippedRuns,
  avgTurn,
  avgDraw,
  stepAvgTurn,
  stepAvgDraw,
  allResults,
  aggregatedSteps,
  usedSeedList,
  params,
  aggregatedKeyChecklist,
  diagnostics,
  scenarioPassCountsObj,
  actionsSummary,
  scenariosSummary,
  stepTileStats,
  stepModalStats,
  stepPerfStats
}) {
  const rep = {
    runnerVersion,
    runs,
    pass,
    fail,
    seriesOk,
    flake,
    flakeScenarios,
    normalizedFlakeScenarios,
    scenarioOutcomes,
    hardFailRuns,
    skipped: skippedRuns,
    avgTurnMs: Number(avgTurn.toFixed ? avgTurn.toFixed(2) : avgTurn),
    avgDrawMs: Number(avgDraw.toFixed ? avgDraw.toFixed(2) : avgDraw),
    stepAvgTurnMs: Number(stepAvgTurn.toFixed ? stepAvgTurn.toFixed(2) : stepAvgTurn),
    stepAvgDrawMs: Number(stepAvgDraw.toFixed ? stepAvgDraw.toFixed(2) : stepAvgDraw),
    results: allResults,
    aggregatedSteps,
    seeds: usedSeedList,
    params,
    keyChecklist: aggregatedKeyChecklist,
    diagnostics,
    scenarioPassCounts: scenarioPassCountsObj,
    actionsSummary,
    scenariosSummary,
    stepTileStats,
    stepModalStats,
    stepPerfStats
  };
  const summaryText = [
    `Roguelike Smoke Test Summary (Runner v${rep.runnerVersion})`,
    `Runs: ${rep.runs}  Pass: ${rep.pass}  Fail: ${rep.fail}  Skipped: ${rep.skipped}`,
    `Avg PERF (per-step): turn ${rep.stepAvgTurnMs} ms, draw ${rep.stepAvgDrawMs} ms`
  ].join("\n");
  return { rep, summaryText };
}
