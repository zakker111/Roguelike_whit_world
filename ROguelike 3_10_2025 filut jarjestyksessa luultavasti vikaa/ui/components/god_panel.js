/**
 * GodPanel: GOD Mode panel component extracted from ui/ui.js
 *
 * Exports (ESM + window.GodPanel):
 * - init(UI)    // wires buttons, sliders, and labels using UI handlers and helpers
 * - show()
 * - hide()
 * - isOpen()
 */
import * as ClientAnalyzer from "/analysis/client_analyzer.js";

function panel() {
  try { return document.getElementById("god-panel"); } catch (_) { return null; }
}
function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}

function populateEncounterSelect() {
  try {
    const el = byId("god-enc-select");
    if (!el) return;
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const list = GD && GD.encounters && Array.isArray(GD.encounters.templates) ? GD.encounters.templates : [];
    const opts = ['<option value="">(auto)</option>'].concat(
      list.map(t => {
        const id = String(t.id || "");
        const name = String(t.name || id || "encounter");
        return `<option value="${id}">${name}</option>`;
      })
    ).join("");
    el.innerHTML = opts;
  } catch (_) {}
}

export function init(UI) {
  // Basic buttons
  const healBtn = byId("god-heal-btn");
  healBtn?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodHeal === "function") UI.handlers.onGodHeal();
  });

  const spawnBtn = byId("god-spawn-btn");
  spawnBtn?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodSpawn === "function") UI.handlers.onGodSpawn();
  });

  const spawnEnemyBtn = byId("god-spawn-enemy-btn");
  spawnEnemyBtn?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodSpawnEnemy === "function") UI.handlers.onGodSpawnEnemy();
  });

  const spawnStairsBtn = byId("god-spawn-stairs-btn");
  spawnStairsBtn?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodSpawnStairs === "function") UI.handlers.onGodSpawnStairs();
  });

  // Status effect test buttons
  const applyBleedBtn = byId("god-apply-bleed-btn");
  applyBleedBtn?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodApplyBleed === "function") UI.handlers.onGodApplyBleed(3);
  });
  const applyDazedBtn = byId("god-apply-dazed-btn");
  applyDazedBtn?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodApplyDazed === "function") UI.handlers.onGodApplyDazed(2);
  });
  const clearEffectsBtn = byId("god-clear-effects-btn");
  clearEffectsBtn?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodClearEffects === "function") UI.handlers.onGodClearEffects();
  });

  // Diagnostics and New Game
  const diagBtn = byId("god-diagnostics-btn");
  diagBtn?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodDiagnostics === "function") UI.handlers.onGodDiagnostics();
  });

  const newGameBtn = byId("god-newgame-btn");
  newGameBtn?.addEventListener("click", () => {
    try { hide(); } catch (_) {}
    if (typeof UI.handlers.onRestart === "function") UI.handlers.onRestart();
  });

  // Smoke Config open
  const smokeBtn = byId("god-run-smoke-btn");
  smokeBtn?.addEventListener("click", () => {
    try { hide(); } catch (_) {}
    try { UI.showSmoke(); } catch (_) {}
  });

  // Prefab editor
  const openPrefabBtn = byId("god-open-prefab-editor-btn");
  openPrefabBtn?.addEventListener("click", () => {
    try {
      const target = "/tools/prefab_editor.html";
      window.location.assign(target);
    } catch (_) {
      try { window.location.href = "/tools/prefab_editor.html"; } catch (_) {}
    }
  });

  // Analysis buttons
  const runBtn = byId("god-run-analysis-btn");
  const dlBtn = byId("god-download-analysis-btn");
  const outDiv = byId("god-analysis-output");
  if (runBtn) {
    runBtn.addEventListener("click", async () => {
      if (!ClientAnalyzer || typeof ClientAnalyzer.runClientAnalysis !== "function") return;
      try {
        runBtn.disabled = true;
        const prevText = runBtn.textContent;
        runBtn.textContent = "Running…";
        const { markdown, topFiles, duplicates, filesScanned } = await ClientAnalyzer.runClientAnalysis();
        UI._lastAnalysisMD = markdown;
        UI._lastAnalysisURL = ClientAnalyzer.makeDownloadURL(markdown);
        if (dlBtn) dlBtn.disabled = !UI._lastAnalysisURL;
        if (outDiv) {
          const lines = [];
          lines.push(`Files scanned: ${filesScanned}`);
          lines.push("Top files:");
          topFiles.slice(0, 8).forEach((m) => { lines.push(`- ${m.file} — ${m.lines} lines`); });
          lines.push(`Duplication candidates: ${duplicates.length} (showing up to 8 below)`);
          duplicates.slice(0, 8).forEach((d) => {
            lines.push(`• ${d.files.length} files — ${d.files.slice(0, 3).join(", ")}${d.files.length > 3 ? ", …" : ""}`);
          });
          outDiv.innerHTML = lines.map((s) => `<div>${s}</div>`).join("");
        }
        runBtn.textContent = prevText || "Run Analysis";
        runBtn.disabled = false;
      } catch (e) {
        try { console.error(e); } catch (_) {}
        if (outDiv) outDiv.innerHTML = `<div style="color:#f87171;">Analysis failed. See console for details.</div>`;
        runBtn.textContent = "Run Analysis";
        runBtn.disabled = false;
      }
    });
  }
  if (dlBtn) {
    dlBtn.addEventListener("click", () => {
      try {
        if (!UI._lastAnalysisURL && UI._lastAnalysisMD) {
          UI._lastAnalysisURL = ClientAnalyzer.makeDownloadURL(UI._lastAnalysisMD);
        }
        if (UI._lastAnalysisURL) {
          const a = document.createElement("a");
          a.href = UI._lastAnalysisURL;
          a.download = "phase1_report_client.md";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      } catch (_) {}
    });
    dlBtn.disabled = true;
  }

  // FOV slider
  const fov = byId("god-fov");
  const fovVal = byId("god-fov-value");
  if (fov) {
    const update = () => {
      const val = parseInt(fov.value, 10);
      try { if (typeof UI.setGodFov === "function") UI.setGodFov(val); } catch (_) {}
      if (typeof UI.handlers.onGodSetFov === "function") UI.handlers.onGodSetFov(val);
    };
    fov.addEventListener("input", update);
    fov.addEventListener("change", update);
    // Initialize value label
    try {
      const v = parseInt(fov.value, 10);
      if (Number.isFinite(v)) {
        if (typeof UI.setGodFov === "function") UI.setGodFov(v);
        else if (fovVal) fovVal.textContent = `FOV: ${v}`;
      }
    } catch (_) {}
  }

  // Encounter rate slider
  const enc = byId("god-enc-rate");
  if (enc) {
    const update = () => {
      const val = parseInt(enc.value, 10);
      try { UI.setEncounterRateState(val); } catch (_) {}
      if (typeof UI.handlers.onGodSetEncounterRate === "function") UI.handlers.onGodSetEncounterRate(val);
    };
    enc.addEventListener("input", update);
    enc.addEventListener("change", update);
    try { UI.updateEncounterRateUI(); } catch (_) {}
  }

  // Encounter select + start/arm
  try {
    if (typeof window !== "undefined" && window.GameData && window.GameData.ready && typeof window.GameData.ready.then === "function") {
      window.GameData.ready.then(() => populateEncounterSelect());
    } else {
      populateEncounterSelect();
    }
  } catch (_) {}
  const encStartBtn = byId("god-enc-start-btn");
  if (encStartBtn) {
    encStartBtn.addEventListener("click", () => {
      const selEl = byId("god-enc-select");
      const sel = selEl ? (selEl.value || "") : "";
      if (typeof UI.handlers.onGodStartEncounterNow === "function") UI.handlers.onGodStartEncounterNow(sel);
    });
  }
  const encArmBtn = byId("god-enc-arm-btn");
  if (encArmBtn) {
    encArmBtn.addEventListener("click", () => {
      const selEl = byId("god-enc-select");
      const sel = selEl ? (selEl.value || "") : "";
      if (typeof UI.handlers.onGodArmEncounterNextMove === "function") UI.handlers.onGodArmEncounterNextMove(sel);
    });
  }

  // Side Log toggle
  const mirrorBtn = byId("god-toggle-mirror-btn");
  if (mirrorBtn) {
    mirrorBtn.addEventListener("click", () => { try { UI.toggleSideLog(); } catch (_) {} });
    try { UI.updateSideLogButton(); } catch (_) {}
  }

  // Always Crit toggle + chooser
  const critBtn = byId("god-toggle-crit-btn");
  if (critBtn) {
    critBtn.addEventListener("click", (ev) => {
      const next = !UI.getAlwaysCritState();
      UI.setAlwaysCritState(next);
      if (typeof UI.handlers.onGodSetAlwaysCrit === "function") UI.handlers.onGodSetAlwaysCrit(next);
      if (next) {
        ev.stopPropagation();
        const rect = critBtn.getBoundingClientRect();
        UI.showHitChooser(rect.left, rect.bottom + 6, (part) => {
          if (part && part !== "cancel") {
            UI.setCritPartState(part);
            if (typeof UI.handlers.onGodSetCritPart === "function") UI.handlers.onGodSetCritPart(part);
          }
        });
      }
    });
    try { UI.updateAlwaysCritButton(); } catch (_) {}
  }

  // Grid toggle
  const gridBtn = byId("god-toggle-grid-btn");
  if (gridBtn) {
    gridBtn.addEventListener("click", () => {
      const next = !UI.getGridState();
      UI.setGridState(next);
      UI.updateGridButton();
      if (typeof UI.handlers.onGodToggleGrid === "function") {
        try { UI.handlers.onGodToggleGrid(next); } catch (_) {}
      }
    });
    try { UI.updateGridButton(); } catch (_) {}
  }

  // Town overlay + path toggles
  const overlayBtn = byId("god-toggle-town-overlay-btn");
  if (overlayBtn) {
    overlayBtn.addEventListener("click", () => {
      const next = !UI.getTownOverlayState();
      UI.setTownOverlayState(next);
      UI.updateTownOverlayButton();
    });
    try { UI.updateTownOverlayButton(); } catch (_) {}
  }

  const townPathsBtn = byId("god-toggle-town-paths-btn");
  if (townPathsBtn) {
    townPathsBtn.addEventListener("click", () => {
      const next = !UI.getTownPathsState();
      UI.setTownPathsState(next);
      UI.updateTownPathsButton();
    });
    try { UI.updateTownPathsButton(); } catch (_) {}
  }

  const homePathsBtn = byId("god-toggle-home-paths-btn");
  if (homePathsBtn) {
    homePathsBtn.addEventListener("click", () => {
      const next = !UI.getHomePathsState();
      UI.setHomePathsState(next);
      UI.updateHomePathsButton();
    });
    try { UI.updateHomePathsButton(); } catch (_) {}
  }

  const routePathsBtn = byId("god-toggle-route-paths-btn");
  if (routePathsBtn) {
    routePathsBtn.addEventListener("click", () => {
      const next = !UI.getRoutePathsState();
      UI.setRoutePathsState(next);
      UI.updateRoutePathsButton();
    });
    try { UI.updateRoutePathsButton(); } catch (_) {}
  }

  // Perf toggle
  const perfBtn = byId("god-toggle-perf-btn");
  if (perfBtn) {
    perfBtn.addEventListener("click", () => {
      const next = !UI.getPerfState();
      UI.setPerfState(next);
      UI.updatePerfButton();
    });
    try { UI.updatePerfButton(); } catch (_) {}
  }

  // Minimap toggle
  const minimapBtn = byId("god-toggle-minimap-btn");
  if (minimapBtn) {
    minimapBtn.addEventListener("click", () => {
      const next = !UI.getMinimapState();
      UI.setMinimapState(next);
      UI.updateMinimapButton();
    });
    try { UI.updateMinimapButton(); } catch (_) {}
  }

  // RNG controls
  const seedApply = byId("god-apply-seed-btn");
  const seedInput = byId("god-seed-input");
  if (seedApply) {
    seedApply.addEventListener("click", () => {
      const raw = (seedInput && seedInput.value) ? seedInput.value.trim() : "";
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) {
        if (typeof UI.handlers.onGodApplySeed === "function") UI.handlers.onGodApplySeed(n >>> 0);
      }
    });
  }
  const seedReroll = byId("god-reroll-seed-btn");
  if (seedReroll) {
    seedReroll.addEventListener("click", () => {
      if (typeof UI.handlers.onGodRerollSeed === "function") UI.handlers.onGodRerollSeed();
    });
  }
  try { UI.updateSeedUI(); } catch (_) {}

  // Checkers
  const checkHome = byId("god-check-home-btn");
  checkHome?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodCheckHomes === "function") UI.handlers.onGodCheckHomes();
  });
  const checkInn = byId("god-check-inn-tavern-btn");
  checkInn?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodCheckInnTavern === "function") UI.handlers.onGodCheckInnTavern();
  });
  const checkSigns = byId("god-check-signs-btn");
  checkSigns?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodCheckSigns === "function") UI.handlers.onGodCheckSigns();
  });
  const checkPrefabs = byId("god-check-prefabs-btn");
  checkPrefabs?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodCheckPrefabs === "function") UI.handlers.onGodCheckPrefabs();
  });
}

export function show() {
  const p = panel();
  if (p) p.hidden = false;
}
export function hide() {
  const p = panel();
  if (p) p.hidden = true;
}
export function isOpen() {
  const p = panel();
  return !!(p && !p.hidden);
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("GodPanel", { init, show, hide, isOpen });