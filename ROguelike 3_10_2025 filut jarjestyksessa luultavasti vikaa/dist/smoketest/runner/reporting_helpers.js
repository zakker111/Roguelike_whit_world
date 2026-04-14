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
