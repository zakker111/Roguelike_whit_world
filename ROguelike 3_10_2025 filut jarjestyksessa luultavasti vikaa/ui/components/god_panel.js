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
import { LogConfig } from "/utils/logging_config.js";

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

function populatePaletteSelect() {
  try {
    const sel = byId("god-palette-select");
    if (!sel) return;
    const GD = (typeof window !== "undefined" ? window.GameData : null);
    const list = (GD && Array.isArray(GD.palettes)) ? GD.palettes : null;

    // Build options from manifest if present; else fallback to default/alt
    let html = "";
    if (list && list.length) {
      html = list.map(p => {
        const id = String(p.id || "");
        const name = String(p.name || id || "palette");
        return `<option value="${id}">${name}</option>`;
      }).join("");
      // Ensure 'default' exists
      if (!list.some(p => String(p.id || "") === "default")) {
        html = `<option value="default">(default)</option>` + html;
      }
    } else {
      html = `<option value="default">(default)</option><option value="alt">alt</option>`;
    }
    sel.innerHTML = html;

    // Set to saved or URL selection if present
    try {
      const params = new URLSearchParams(location.search);
      let value = params.get("palette") || localStorage.getItem("PALETTE") || "default";
      sel.value = value;
    } catch (_) {}
  } catch (_) {}
}

// Build or refresh the Log categories checkbox list
function renderLogCategories() {
  try {
    const container = byId("god-log-categories");
    if (!container) return;

    // Keep scroll position if re-rendering
    const prevScroll = container.scrollTop;

    let cats = [];
    try {
      cats = (LogConfig && typeof LogConfig.getCategories === "function") ? LogConfig.getCategories() : [];
    } catch (_) {}

    // Fallback list if LogConfig not ready
    if (!cats || !cats.length) {
      cats = [
        { id: "general", enabled: true },
        { id: "palette", enabled: true },
        { id: "items", enabled: true },
        { id: "enemies", enabled: true },
        { id: "ai", enabled: true },
        { id: "combat", enabled: true },
        { id: "dungeon", enabled: true },
        { id: "world", enabled: true },
        { id: "render", enabled: true },
        { id: "ui", enabled: true }
      ];
    }

    const html = cats.map((c) => {
      const id = c && c.id ? String(c.id) : "";
      if (!id) return "";
      const checked = c.enabled ? " checked" : "";
      const label = (LogConfig && typeof LogConfig.displayName === "function") ? LogConfig.displayName(id) : (id.charAt(0).toUpperCase() + id.slice(1));
      return `
        <label style="display:flex; align-items:center; gap:6px; padding:4px 6px; border:1px solid #253047; border-radius:6px; background:#0f1117;">
          <input type="checkbox" class="log-cat-sel" value="${id}"${checked} />
          <span style="color:#cbd5e1; font-size:13px;">${label}</span>
        </label>
      `;
    }).join("");
    container.innerHTML = html;

    // Restore scroll
    container.scrollTop = prevScroll;
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

  const runValBtn = byId("god-run-validation-btn");
  runValBtn?.addEventListener("click", () => {
    if (typeof UI.handlers.onGodRunValidation === "function") UI.handlers.onGodRunValidation();
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

  // Trace toggles: movement, encounters, shops
  const traceMoveBtn = byId("god-toggle-trace-move-btn");
  const traceEncBtn = byId("god-toggle-trace-enc-btn");
  const traceShopBtn = byId("god-toggle-trace-shop-btn");

  function _lsGetBool(key) {
    try { const v = localStorage.getItem(key); return String(v).toLowerCase() === "1"; } catch (_) { return false; }
  }
  function _lsSetBool(key, on) {
    try { if (on) localStorage.setItem(key, "1"); else localStorage.removeItem(key); } catch (_) {}
  }
  function _isDev() { try { return !!window.DEV; } catch (_) { return false; } }

  function updateTraceMoveButton() {
    try {
      if (!traceMoveBtn) return;
      const active = _isDev() || _lsGetBool("LOG_TRACE_MOVEMENT");
      traceMoveBtn.textContent = `Trace Move: ${active ? "On" : "Off"}`;
    } catch (_) {}
  }
  function updateTraceEncButton() {
    try {
      if (!traceEncBtn) return;
      const active = _isDev() || _lsGetBool("LOG_TRACE_ENCOUNTERS");
      traceEncBtn.textContent = `Trace Enc: ${active ? "On" : "Off"}`;
    } catch (_) {}
  }
  function updateTraceShopButton() {
    try {
      if (!traceShopBtn) return;
      const active = _isDev() || _lsGetBool("LOG_TRACE_SHOPS");
      traceShopBtn.textContent = `Trace Shop: ${active ? "On" : "Off"}`;
    } catch (_) {}
  }

  if (traceMoveBtn) {
    traceMoveBtn.addEventListener("click", () => {
      const next = !_lsGetBool("LOG_TRACE_MOVEMENT");
      _lsSetBool("LOG_TRACE_MOVEMENT", next);
      updateTraceMoveButton();
    });
    updateTraceMoveButton();
  }
  if (traceEncBtn) {
    traceEncBtn.addEventListener("click", () => {
      const next = !_lsGetBool("LOG_TRACE_ENCOUNTERS");
      _lsSetBool("LOG_TRACE_ENCOUNTERS", next);
      updateTraceEncButton();
    });
    updateTraceEncButton();
  }
  if (traceShopBtn) {
    traceShopBtn.addEventListener("click", () => {
      const next = !_lsGetBool("LOG_TRACE_SHOPS");
      _lsSetBool("LOG_TRACE_SHOPS", next);
      updateTraceShopButton();
    });
    updateTraceShopButton();
  }

  // Log level select
  const lvlSel = byId("god-log-level");
  if (lvlSel) {
    try {
      const cur = (LogConfig && typeof LogConfig.getThresholdName === "function") ? LogConfig.getThresholdName() : "info";
      // Ensure value is one of the options
      const valid = new Set(["info","notice","warn","error","fatal","all"]);
      lvlSel.value = valid.has(cur) ? cur : "info";
    } catch (_) {}
    lvlSel.addEventListener("change", () => {
      try {
        const val = lvlSel.value || "info";
        if (LogConfig && typeof LogConfig.setThreshold === "function") LogConfig.setThreshold(val);
      } catch (_) {}
    });
  }

  // Categories list (checkboxes)
  const catContainer = byId("god-log-categories");
  if (catContainer) {
    try { renderLogCategories(); } catch (_) {}
    catContainer.addEventListener("change", (ev) => {
      try {
        const t = ev && ev.target;
        if (t && t.classList && t.classList.contains("log-cat-sel")) {
          const id = t.value || "";
          const enabled = !!t.checked;
          if (LogConfig && typeof LogConfig.setCategory === "function") LogConfig.setCategory(id, enabled);
        }
      } catch (_) {}
    });
  }

  // Reset log filters
  const resetBtn = byId("god-log-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      try {
        if (LogConfig && typeof LogConfig.reset === "function") LogConfig.reset();
        // Sync UI after reset
        if (lvlSel && LogConfig && typeof LogConfig.getThresholdName === "function") {
          lvlSel.value = LogConfig.getThresholdName();
        }
        renderLogCategories();
      } catch (_) {}
    });
  }

  // Download & clear logs
  const dlLogsBtn = byId("god-log-download-btn");
  if (dlLogsBtn) {
    dlLogsBtn.addEventListener("click", () => {
      try {
        if (typeof window !== "undefined" && window.Logger && typeof window.Logger.download === "function") {
          window.Logger.download("game_logs.txt");
        }
      } catch (_) {}
    });
  }
  const dlLogsJSONBtn = byId("god-log-download-json-btn");
  if (dlLogsJSONBtn) {
    dlLogsJSONBtn.addEventListener("click", () => {
      try {
        if (typeof window !== "undefined" && window.Logger && typeof window.Logger.downloadJSON === "function") {
          window.Logger.downloadJSON("game_logs.json");
        }
      } catch (_) {}
    });
  }
  const clearLogsBtn = byId("god-log-clear-btn");
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener("click", () => {
      try {
        if (typeof window !== "undefined" && window.Logger && typeof window.Logger.clear === "function") {
          window.Logger.clear();
        }
      } catch (_) {}
    });
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

  // Apply status effect: show a small chooser and arm next hit with the selected effect.
  const applyStatusBtn = byId("god-apply-status-btn");
  if (applyStatusBtn) {
    let statusMenuEl = null;

    function closeStatusMenu() {
      if (statusMenuEl && statusMenuEl.parentNode) {
        statusMenuEl.parentNode.removeChild(statusMenuEl);
      }
      statusMenuEl = null;
    }

    function openStatusMenu() {
      closeStatusMenu();
      const rect = applyStatusBtn.getBoundingClientRect();
      const menu = document.createElement("div");
      menu.id = "god-status-menu";
      menu.style.position = "fixed";
      menu.style.left = `${Math.round(rect.left)}px`;
      menu.style.top = `${Math.round(rect.bottom + 4)}px`;
      menu.style.zIndex = "32000";
      menu.style.background = "#020617";
      menu.style.border = "1px solid #334155";
      menu.style.borderRadius = "6px";
      menu.style.padding = "6px 6px";
      menu.style.minWidth = "210px";
      menu.style.boxShadow = "0 10px 25px rgba(0,0,0,0.6)";

      const effects = [
        { id: "bleed", label: "Bleed (enemy bleeds 3 turns)" },
        { id: "limp", label: "Limp (enemy can't move 2 turns)" },
        { id: "fire", label: "In Flames (set enemy on fire)" },
      ];

      effects.forEach((e) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = e.label;
        btn.style.display = "block";
        btn.style.width = "100%";
        btn.style.textAlign = "left";
        btn.style.padding = "4px 8px";
        btn.style.margin = "2px 0";
        btn.style.fontSize = "12px";
        btn.style.borderRadius = "4px";
        btn.style.border = "1px solid #1e293b";
        btn.style.background = "#0b1120";
        btn.style.color = "#e5e7eb";
        btn.style.cursor = "pointer";
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          closeStatusMenu();
          if (typeof UI.handlers.onGodApplyStatusEffect === "function") {
            UI.handlers.onGodApplyStatusEffect(e.id);
          }
        });
        btn.addEventListener("mouseenter", () => {
          btn.style.background = "#111827";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.background = "#0b1120";
        });
        menu.appendChild(btn);
      });

      document.body.appendChild(menu);
      statusMenuEl = menu;

      // Close when clicking outside
      setTimeout(() => {
        function onDocClick(ev) {
          if (!statusMenuEl) {
            document.removeEventListener("click", onDocClick);
            return;
          }
          if (ev.target === applyStatusBtn || statusMenuEl.contains(ev.target)) return;
          closeStatusMenu();
          document.removeEventListener("click", onDocClick);
        }
        document.addEventListener("click", onDocClick);
      }, 0);
    }

    applyStatusBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (statusMenuEl) closeStatusMenu();
      else openStatusMenu();
    });
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

  // HUD toggles
  const owHudBtn = byId("god-toggle-ow-hud-btn");
  if (owHudBtn) {
    owHudBtn.addEventListener("click", () => {
      const next = !UI.getOverworldHudState();
      UI.setOverworldHudState(next);
      UI.updateOverworldHudButton();
    });
    try { UI.updateOverworldHudButton(); } catch (_) {}
  }

  const regionHudBtn = byId("god-toggle-region-hud-btn");
  if (regionHudBtn) {
    regionHudBtn.addEventListener("click", () => {
      const next = !UI.getRegionHudState();
      UI.setRegionHudState(next);
      UI.updateRegionHudButton();
    });
    try { UI.updateRegionHudButton(); } catch (_) {}
  }

  const encHudBtn = byId("god-toggle-enc-hud-btn");
  if (encHudBtn) {
    encHudBtn.addEventListener("click", () => {
      const next = !UI.getEncounterHudState();
      UI.setEncounterHudState(next);
      UI.updateEncounterHudButton();
    });
    try { UI.updateEncounterHudButton(); } catch (_) {}
  }

  // Validation download
  const valBtn = byId("god-download-validation-btn");
  if (valBtn) {
    valBtn.addEventListener("click", () => {
      try {
        const VR = (typeof window !== "undefined" ? window.ValidationRunner : null);
        if (!VR || typeof VR.getReport !== "function") {
          const ctx = (typeof window !== "undefined" && window.GameAPI && typeof window.GameAPI.getCtx === "function") ? window.GameAPI.getCtx() : null;
          if (ctx && typeof ctx.log === "function") ctx.log("ValidationRunner.getReport not available.", "warn");
          return;
        }
        const rep = VR.getReport();
        const blob = new Blob([JSON.stringify(rep, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "validation_report.json";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try { document.body.removeChild(a); } catch (_) {}
          try { URL.revokeObjectURL(url); } catch (_) {}
        }, 100);
      } catch (e) {
        try { console.error("Validation export failed", e); } catch (_) {}
      }
    });
  }

  // Palette switcher
  const palSel = byId("god-palette-select");
  const palApply = byId("god-apply-palette-btn");
  // Populate list once GameData is ready
  try {
    if (typeof window !== "undefined" && window.GameData && window.GameData.ready && typeof window.GameData.ready.then === "function") {
      window.GameData.ready.then(() => populatePaletteSelect());
    } else {
      populatePaletteSelect();
    }
  } catch (_) {}
  if (palApply) {
    palApply.addEventListener("click", async () => {
      const val = palSel ? (palSel.value || "default") : "default";
      try {
        if (typeof window !== "undefined" && window.GameData && typeof window.GameData.loadPalette === "function") {
          await window.GameData.loadPalette(val);
        }
      } catch (_) {}
    });
  }

  // RNG controls
  const seedApply = byId("god-apply-seed-btn");
  const seedInput = byId("god-seed-input");
  function applySeedFromInput() {
    try {
      const raw = (seedInput && typeof seedInput.value === "string") ? seedInput.value.trim() : "";
      // Keep digits only; ignore any non-numeric characters
      const digits = raw.replace(/[^\d]/g, "");
      if (!digits) return;
      const n = Number(digits);
      if (Number.isFinite(n) && n >= 0) {
        if (typeof UI.handlers.onGodApplySeed === "function") UI.handlers.onGodApplySeed(n >>> 0);
      }
    } catch (_) {}
  }
  if (seedApply) {
    seedApply.addEventListener("click", applySeedFromInput);
  }
  if (seedInput) {
    // Press Enter inside the seed box to apply immediately
    seedInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        applySeedFromInput();
      }
    });
  }
  const seedReroll = byId("god-reroll-seed-btn");
  if (seedReroll) {
    seedReroll.addEventListener("click", () => {
      // Treat Reroll as a full new run when possible: reuse the core restartGame()
      // path via onRestart so player + world are both reset with a fresh seed.
      if (typeof UI.handlers.onRestart === "function") {
        try { hide(); } catch (_) {}
        UI.handlers.onRestart();
        return;
      }
      // Fallback: legacy behavior that only rerolls RNG/map without resetting player.
      if (typeof UI.handlers.onGodRerollSeed === "function") {
        UI.handlers.onGodRerollSeed();
      }
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

  // Town events
  const townBanditsBtn = byId("god-town-bandits-btn");
  if (townBanditsBtn) {
    townBanditsBtn.addEventListener("click", () => {
      if (typeof UI.handlers.onGodTownBandits === "function") UI.handlers.onGodTownBandits();
    });
  }
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