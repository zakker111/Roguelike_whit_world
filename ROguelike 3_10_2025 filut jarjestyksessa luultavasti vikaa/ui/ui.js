/**
 * UI: HUD, inventory/equipment panel, loot panel, game over panel, and GOD panel.
 *
 * Exports (ESM + window.UI):
 * - init()
 * - setHandlers({...})
 * - updateStats(player, floor, getAtk, getDef)
 * - renderInventory(player, describeItem)
 * - showInventory()/hideInventory()/isInventoryOpen()
 * - showLoot(list)/hideLoot()/isLootOpen()
 * - showGameOver(player, floor)/hideGameOver()
 *
 * Notes:
 * - GOD panel includes: Heal, spawn items/enemy, FOV slider, side log toggle, Always Crit toggle with body-part chooser.
 * - Persists user toggles in localStorage (LOG_MIRROR, ALWAYS_CRIT, ALWAYS_CRIT_PART).
 */
import * as ClientAnalyzer from "/analysis/client_analyzer.js";
import * as HelpModal from "/ui/components/help_modal.js";
import * as RegionModal from "/ui/components/region_modal.js";
import * as SmokeModal from "/ui/components/smoke_modal.js";

export const UI = {
  els: {},
  handlers: {
    onEquip: null,
    onEquipHand: null,
    onUnequip: null,
    onDrink: null,
    onRestart: null,
    onWait: null,
    onGodHeal: null,
    onGodSpawn: null,
    onGodSetFov: null,
    onGodSetEncounterRate: null,
    onGodSpawnEnemy: null,
    onTownExit: null,
  },

  init() {
    this.els.hpEl = document.getElementById("health");
    this.els.floorEl = document.getElementById("floor");
    this.els.logEl = document.getElementById("log");
    this.els.lootPanel = document.getElementById("loot-panel");
    this.els.lootList = document.getElementById("loot-list");
    this.els.gameOverPanel = document.getElementById("gameover-panel");
    this.els.gameOverSummary = document.getElementById("gameover-summary");
    this.els.restartBtn = document.getElementById("restart-btn");
    this.els.waitBtn = document.getElementById("wait-btn");
    this.els.invPanel = document.getElementById("inv-panel");
    this.els.invList = document.getElementById("inv-list");
    this.els.equipSlotsEl = document.getElementById("equip-slots");
    this.els.invStatsEl = document.getElementById("inv-stats");

    // GOD mode elements
    this.els.godOpenBtn = document.getElementById("god-open-btn");
    this.els.helpOpenBtn = document.getElementById("help-open-btn");
    this.els.godPanel = document.getElementById("god-panel");
    this.els.godHealBtn = document.getElementById("god-heal-btn");
    this.els.godSpawnBtn = document.getElementById("god-spawn-btn");
    this.els.godSpawnEnemyBtn = document.getElementById("god-spawn-enemy-btn");
    this.els.godSpawnStairsBtn = document.getElementById("god-spawn-stairs-btn");
    this.els.godFov = document.getElementById("god-fov");
    this.els.godFovValue = document.getElementById("god-fov-value");
    this.els.godEncRate = document.getElementById("god-enc-rate");
    this.els.godEncRateValue = document.getElementById("god-enc-rate-value");
    // Encounter debug controls
    this.els.godEncSelect = document.getElementById("god-enc-select");
    this.els.godEncStartBtn = document.getElementById("god-enc-start-btn");
    this.els.godEncArmBtn = document.getElementById("god-enc-arm-btn");

    this.els.godToggleMirrorBtn = document.getElementById("god-toggle-mirror-btn");
    this.els.godToggleCritBtn = document.getElementById("god-toggle-crit-btn");
    this.els.godToggleGridBtn = document.getElementById("god-toggle-grid-btn");
    this.els.godSeedInput = document.getElementById("god-seed-input");
    this.els.godApplySeedBtn = document.getElementById("god-apply-seed-btn");
    this.els.godRerollSeedBtn = document.getElementById("god-reroll-seed-btn");
    this.els.godSeedHelp = document.getElementById("god-seed-help");
    // Status effect test buttons
    this.els.godApplyBleedBtn = document.getElementById("god-apply-bleed-btn");
    this.els.godApplyDazedBtn = document.getElementById("god-apply-dazed-btn");
    this.els.godClearEffectsBtn = document.getElementById("god-clear-effects-btn");
    // Check Home Routes button
    this.els.godCheckHomeBtn = document.getElementById("god-check-home-btn");
    // Check Inn/Tavern button
    this.els.godCheckInnTavernBtn = document.getElementById("god-check-inn-tavern-btn");
    // Check Signs button
    this.els.godCheckSignsBtn = document.getElementById("god-check-signs-btn");
    // Check Prefabs button
    this.els.godCheckPrefabsBtn = document.getElementById("god-check-prefabs-btn");
    // Smoke test run count (legacy in GOD panel; unused for new panel)
    this.els.godSmokeCount = document.getElementById("god-smoke-count");
    // Smoke config elements
    this.els.smokePanel = document.getElementById("smoke-panel");
    this.els.smokeList = document.getElementById("smoke-scenarios");
    this.els.smokeRunBtn = document.getElementById("smoke-run-btn");
    this.els.smokeCancelBtn = document.getElementById("smoke-cancel-btn");
    this.els.smokeCount = document.getElementById("smoke-count");
    

    // transient hand-chooser element
    this.els.handChooser = document.createElement("div");
    this.els.handChooser.style.position = "fixed";
    this.els.handChooser.style.display = "none";
    this.els.handChooser.style.zIndex = "50000";
    this.els.handChooser.style.background = "rgba(20,24,33,0.98)";
    this.els.handChooser.style.border = "1px solid rgba(80,90,120,0.6)";
    this.els.handChooser.style.borderRadius = "6px";
    this.els.handChooser.style.padding = "8px";
    this.els.handChooser.style.boxShadow = "0 8px 28px rgba(0,0,0,0.4)";
    this.els.handChooser.innerHTML = `
      <div style="color:#cbd5e1; font-size:12px; margin-bottom:6px;">Equip to:</div>
      <div style="display:flex; gap:6px;">
        <button data-hand="left" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Left</button>
        <button data-hand="right" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Right</button>
        <button data-hand="cancel" style="padding:6px 10px; background:#111827; color:#9ca3af; border:1px solid #374151; border-radius:4px; cursor:pointer;">Cancel</button>
      </div>
    `;
    document.body.appendChild(this.els.handChooser);

    // transient crit-hit-part chooser
    this.els.hitChooser = document.createElement("div");
    this.els.hitChooser.style.position = "fixed";
    this.els.hitChooser.style.display = "none";
    this.els.hitChooser.style.zIndex = "50000";
    this.els.hitChooser.style.background = "rgba(20,24,33,0.98)";
    this.els.hitChooser.style.border = "1px solid rgba(80,90,120,0.6)";
    this.els.hitChooser.style.borderRadius = "6px";
    this.els.hitChooser.style.padding = "8px";
    this.els.hitChooser.style.boxShadow = "0 8px 28px rgba(0,0,0,0.4)";
    this.els.hitChooser.innerHTML = `
      <div style="color:#cbd5e1; font-size:12px; margin-bottom:6px;">Force crit to:</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; max-width:280px;">
        <button data-part="torso" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Torso</button>
        <button data-part="head" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Head</button>
        <button data-part="hands" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Hands</button>
        <button data-part="legs" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Legs</button>
        <button data-part="cancel" style="padding:6px 10px; background:#111827; color:#9ca3af; border:1px solid #374151; border-radius:4px; cursor:pointer;">Cancel</button>
      </div>
    `;
    document.body.appendChild(this.els.hitChooser);

    // Transient confirm dialog
    this.els.confirm = document.createElement("div");
    this.els.confirm.style.position = "fixed";
    this.els.confirm.style.display = "none";
    this.els.confirm.style.zIndex = "50001";
    this.els.confirm.style.background = "rgba(20,24,33,0.98)";
    this.els.confirm.style.border = "1px solid rgba(80,90,120,0.6)";
    this.els.confirm.style.borderRadius = "8px";
    this.els.confirm.style.padding = "12px";
    this.els.confirm.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
    this.els.confirm.style.minWidth = "280px";
    this.els.confirm.innerHTML = `
      <div id="ui-confirm-text" style="color:#e5e7eb; font-size:14px; margin-bottom:10px;">Are you sure?</div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button data-act="cancel" style="padding:6px 10px; background:#111827; color:#9ca3af; border:1px solid #374151; border-radius:4px; cursor:pointer;">Cancel</button>
        <button data-act="ok" style="padding:6px 12px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">OK</button>
      </div>
    `;
    document.body.appendChild(this.els.confirm);

    // Floating Town Exit button (hidden by default, shown in town)
    this.els.townExitBtn = document.createElement("button");
    const b = this.els.townExitBtn;
    b.textContent = "Exit Town";
    b.style.position = "fixed";
    b.style.right = "16px";
    b.style.bottom = "16px";
    b.style.padding = "8px 12px";
    b.style.fontSize = "14px";
    b.style.background = "#1f2937";
    b.style.color = "#e5e7eb";
    b.style.border = "1px solid #334155";
    b.style.borderRadius = "6px";
    b.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
    b.style.cursor = "pointer";
    b.style.display = "none";
    b.title = "Leave the town";
    document.body.appendChild(b);

    // Bind static events
    this.els.lootPanel?.addEventListener("click", () => this.hideLoot());
    this.els.restartBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onRestart === "function") this.handlers.onRestart();
    });
    // Wait button (spend one turn)
    this.els.waitBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onWait === "function") this.handlers.onWait();
    });

    // GOD panel open + actions
    this.els.godOpenBtn?.addEventListener("click", () => this.showGod());
    // Help panel open (same as F1)
    this.els.helpOpenBtn?.addEventListener("click", () => this.showHelp());
    this.els.godHealBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodHeal === "function") this.handlers.onGodHeal();
    });
    this.els.godSpawnBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodSpawn === "function") this.handlers.onGodSpawn();
    });
    this.els.godSpawnEnemyBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodSpawnEnemy === "function") this.handlers.onGodSpawnEnemy();
    });
    this.els.godSpawnStairsBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodSpawnStairs === "function") this.handlers.onGodSpawnStairs();
    });
    this.els.godCheckHomeBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodCheckHomes === "function") this.handlers.onGodCheckHomes();
    });
    this.els.godCheckInnTavernBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodCheckInnTavern === "function") this.handlers.onGodCheckInnTavern();
    });
    this.els.godCheckSignsBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodCheckSigns === "function") this.handlers.onGodCheckSigns();
    });
    this.els.godCheckPrefabsBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodCheckPrefabs === "function") this.handlers.onGodCheckPrefabs();
    });
    // Prefab Editor (DEV-only route)
    const openPrefabBtn = document.getElementById("god-open-prefab-editor-btn");
    openPrefabBtn?.addEventListener("click", () => {
      try {
        const target = "/tools/prefab_editor.html";
        window.location.assign(target);
      } catch (_) {
        try { window.location.href = "/tools/prefab_editor.html"; } catch (_) {}
      }
    });
    // Status effect test buttons
    this.els.godApplyBleedBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodApplyBleed === "function") this.handlers.onGodApplyBleed(3);
    });
    this.els.godApplyDazedBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodApplyDazed === "function") this.handlers.onGodApplyDazed(2);
    });
    this.els.godClearEffectsBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodClearEffects === "function") this.handlers.onGodClearEffects();
    });
    const diagBtn = document.getElementById("god-diagnostics-btn");
    diagBtn?.addEventListener("click", () => {
      if (typeof this.handlers.onGodDiagnostics === "function") this.handlers.onGodDiagnostics();
    });
    const newGameBtn = document.getElementById("god-newgame-btn");
    newGameBtn?.addEventListener("click", () => {
      // Close GOD panel and trigger restart/new game
      try { this.hideGod(); } catch (_) {}
      if (typeof this.handlers.onRestart === "function") this.handlers.onRestart();
    });
    const smokeBtn = document.getElementById("god-run-smoke-btn");
    smokeBtn?.addEventListener("click", () => {
      // Close GOD mode and open Smoke Config panel
      try { this.hideGod(); } catch (_) {}
      try { this.showSmoke(); } catch (_) {}
    });

    // Analysis buttons (client-side report)
    this.els.godRunAnalysisBtn = document.getElementById("god-run-analysis-btn");
    this.els.godDownloadAnalysisBtn = document.getElementById("god-download-analysis-btn");
    this.els.godAnalysisOutput = document.getElementById("god-analysis-output");
    if (this.els.godRunAnalysisBtn) {
      this.els.godRunAnalysisBtn.addEventListener("click", async () => {
        if (!ClientAnalyzer || typeof ClientAnalyzer.runClientAnalysis !== "function") return;
        try {
          // Disable while running
          const btn = this.els.godRunAnalysisBtn;
          btn.disabled = true;
          const prevText = btn.textContent;
          btn.textContent = "Running…";
          const { markdown, topFiles, duplicates, filesScanned } = await ClientAnalyzer.runClientAnalysis();
          // Cache for download
          this._lastAnalysisMD = markdown;
          this._lastAnalysisURL = ClientAnalyzer.makeDownloadURL(markdown);
          // Enable download button
          if (this.els.godDownloadAnalysisBtn) {
            this.els.godDownloadAnalysisBtn.disabled = !this._lastAnalysisURL;
          }
          // Render a short summary in GOD panel
          if (this.els.godAnalysisOutput) {
            const lines = [];
            lines.push(`Files scanned: ${filesScanned}`);
            lines.push("Top files:");
            topFiles.slice(0, 8).forEach((m) => {
              lines.push(`- ${m.file} — ${m.lines} lines`);
            });
            lines.push(`Duplication candidates: ${duplicates.length} (showing up to 8 below)`);
            duplicates.slice(0, 8).forEach((d) => {
              lines.push(`• ${d.files.length} files — ${d.files.slice(0, 3).join(", ")}${d.files.length > 3 ? ", …" : ""}`);
            });
            this.els.godAnalysisOutput.innerHTML = lines.map((s) => `<div>${s}</div>`).join("");
          }
          // Restore button
          btn.textContent = prevText || "Run Analysis";
          btn.disabled = false;
        } catch (e) {
          try { console.error(e); } catch (_) {}
          if (this.els.godAnalysisOutput) {
            this.els.godAnalysisOutput.innerHTML = `<div style="color:#f87171;">Analysis failed. See console for details.</div>`;
          }
          if (this.els.godRunAnalysisBtn) {
            this.els.godRunAnalysisBtn.textContent = "Run Analysis";
            this.els.godRunAnalysisBtn.disabled = false;
          }
        }
      });
    }
    if (this.els.godDownloadAnalysisBtn) {
      this.els.godDownloadAnalysisBtn.addEventListener("click", () => {
        try {
          if (!this._lastAnalysisURL && this._lastAnalysisMD) {
            this._lastAnalysisURL = ClientAnalyzer.makeDownloadURL(this._lastAnalysisMD);
          }
          if (this._lastAnalysisURL) {
            const a = document.createElement("a");
            a.href = this._lastAnalysisURL;
            a.download = "phase1_report_client.md";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
        } catch (_) {}
      });
      // Initially disabled until a report is generated
      this.els.godDownloadAnalysisBtn.disabled = true;
    }
    
    if (this.els.godFov) {
      const updateFov = () => {
        const val = parseInt(this.els.godFov.value, 10);
        this.setGodFov(val);
        if (typeof this.handlers.onGodSetFov === "function") this.handlers.onGodSetFov(val);
      };
      this.els.godFov.addEventListener("input", updateFov);
      this.els.godFov.addEventListener("change", updateFov);
    }
    if (this.els.godEncRate) {
      const updateEncRate = () => {
        const val = parseInt(this.els.godEncRate.value, 10);
        this.setEncounterRateState(val);
        if (typeof this.handlers.onGodSetEncounterRate === "function") this.handlers.onGodSetEncounterRate(val);
      };
      this.els.godEncRate.addEventListener("input", updateEncRate);
      this.els.godEncRate.addEventListener("change", updateEncRate);
    }
    // Populate encounter select with templates once GameData is ready
    (function initEncounterSelect(self) {
      try {
        const apply = () => {
          const el = self.els.godEncSelect;
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
        };
        if (typeof window !== "undefined" && window.GameData && window.GameData.ready && typeof window.GameData.ready.then === "function") {
          window.GameData.ready.then(() => apply());
        } else {
          apply();
        }
      } catch (_) {}
    })(this);
    if (this.els.godEncStartBtn) {
      this.els.godEncStartBtn.addEventListener("click", () => {
        const sel = this.els.godEncSelect ? (this.els.godEncSelect.value || "") : "";
        if (typeof this.handlers.onGodStartEncounterNow === "function") this.handlers.onGodStartEncounterNow(sel);
      });
    }
    if (this.els.godEncArmBtn) {
      this.els.godEncArmBtn.addEventListener("click", () => {
        const sel = this.els.godEncSelect ? (this.els.godEncSelect.value || "") : "";
        if (typeof this.handlers.onGodArmEncounterNextMove === "function") this.handlers.onGodArmEncounterNextMove(sel);
      });
    }
    if (this.els.godToggleMirrorBtn) {
      this.els.godToggleMirrorBtn.addEventListener("click", () => {
        this.toggleSideLog();
      });
      // initialize label
      this.updateSideLogButton();
    }
    if (this.els.godToggleCritBtn) {
      this.els.godToggleCritBtn.addEventListener("click", (ev) => {
        const btn = ev.currentTarget;
        const next = !this.getAlwaysCritState();
        this.setAlwaysCritState(next);
        if (typeof this.handlers.onGodSetAlwaysCrit === "function") {
          this.handlers.onGodSetAlwaysCrit(next);
        }
        // When enabling, ask for preferred hit location
        if (next) {
          // Prevent this click from triggering the global document click handler that hides choosers
          ev.stopPropagation();
          const rect = btn.getBoundingClientRect();
          this.showHitChooser(rect.left, rect.bottom + 6, (part) => {
            if (part && part !== "cancel") {
              this.setCritPartState(part);
              if (typeof this.handlers.onGodSetCritPart === "function") {
                this.handlers.onGodSetCritPart(part);
              }
            }
          });
        }
      });
      this.updateAlwaysCritButton();
    }
    if (this.els.godToggleGridBtn) {
      this.els.godToggleGridBtn.addEventListener("click", () => {
        const next = !this.getGridState();
        this.setGridState(next);
        this.updateGridButton();
        // Notify game so ctx.drawGrid can be set (ctx-first render preference)
        if (typeof this.handlers.onGodToggleGrid === "function") {
          try { this.handlers.onGodToggleGrid(next); } catch (_) {}
        }
      });
      this.updateGridButton();
    }
    // Town overlay toggle
    this.els.godToggleTownOverlayBtn = document.getElementById("god-toggle-town-overlay-btn");
    if (this.els.godToggleTownOverlayBtn) {
      this.els.godToggleTownOverlayBtn.addEventListener("click", () => {
        const next = !this.getTownOverlayState();
        this.setTownOverlayState(next);
        this.updateTownOverlayButton();
      });
      this.updateTownOverlayButton();
    }
    // Town paths toggle
    this.els.godToggleTownPathsBtn = document.getElementById("god-toggle-town-paths-btn");
    if (this.els.godToggleTownPathsBtn) {
      this.els.godToggleTownPathsBtn.addEventListener("click", () => {
        const next = !this.getTownPathsState();
        this.setTownPathsState(next);
        this.updateTownPathsButton();
      });
      this.updateTownPathsButton();
    }
    // Home paths toggle
    this.els.godToggleHomePathsBtn = document.getElementById("god-toggle-home-paths-btn");
    if (this.els.godToggleHomePathsBtn) {
      this.els.godToggleHomePathsBtn.addEventListener("click", () => {
        const next = !this.getHomePathsState();
        this.setHomePathsState(next);
        this.updateHomePathsButton();
      });
      this.updateHomePathsButton();
    }
    // Route paths toggle (current destination)
    this.els.godToggleRoutePathsBtn = document.getElementById("god-toggle-route-paths-btn");
    if (this.els.godToggleRoutePathsBtn) {
      this.els.godToggleRoutePathsBtn.addEventListener("click", () => {
        const next = !this.getRoutePathsState();
        this.setRoutePathsState(next);
        this.updateRoutePathsButton();
      });
      this.updateRoutePathsButton();
    }
    // Perf overlay toggle
    this.els.godTogglePerfBtn = document.getElementById("god-toggle-perf-btn");
    if (this.els.godTogglePerfBtn) {
      this.els.godTogglePerfBtn.addEventListener("click", () => {
        const next = !this.getPerfState();
        this.setPerfState(next);
        this.updatePerfButton();
      });
      this.updatePerfButton();
    }
    // Minimap toggle
    this.els.godToggleMinimapBtn = document.getElementById("god-toggle-minimap-btn");
    if (this.els.godToggleMinimapBtn) {
      this.els.godToggleMinimapBtn.addEventListener("click", () => {
        const next = !this.getMinimapState();
        this.setMinimapState(next);
        this.updateMinimapButton();
      });
      this.updateMinimapButton();
    }
    
    // RNG seed controls
    if (this.els.godApplySeedBtn) {
      this.els.godApplySeedBtn.addEventListener("click", () => {
        const raw = (this.els.godSeedInput && this.els.godSeedInput.value) ? this.els.godSeedInput.value.trim() : "";
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) {
          if (typeof this.handlers.onGodApplySeed === "function") this.handlers.onGodApplySeed(n >>> 0);
        } else {
          // no-op; optionally show hint
        }
      });
    }
    if (this.els.godRerollSeedBtn) {
      this.els.godRerollSeedBtn.addEventListener("click", () => {
        if (typeof this.handlers.onGodRerollSeed === "function") this.handlers.onGodRerollSeed();
      });
    }
    this.updateSeedUI();
    this.updateEncounterRateUI();

    // Smoke config buttons
    if (this.els.smokeRunBtn) {
      this.els.smokeRunBtn.addEventListener("click", () => {
        // Collect selected scenarios
        const boxes = (this.els.smokeList ? Array.from(this.els.smokeList.querySelectorAll("input.smoke-sel")) : []);
        const sel = boxes.filter(b => b.checked).map(b => b.value);
        // Fallback: all scenarios if none selected
        const scenarios = sel.length ? sel : ["world","dungeon","inventory","combat","dungeon_persistence","town","town_diagnostics","overlays","determinism"];
        // Runs
        const countRaw = (this.els.smokeCount && this.els.smokeCount.value) ? this.els.smokeCount.value.trim() : "1";
        const count = Math.max(1, Math.min(20, parseInt(countRaw, 10) || 1));
        // Close panel, then start via URL params (auto-inject loader)
        try { this.hideSmoke(); } catch (_) {}
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("smoketest", "1");
          url.searchParams.set("smokecount", String(count));
          url.searchParams.set("scenarios", scenarios.join(","));
          if (window.DEV || localStorage.getItem("DEV") === "1") {
            url.searchParams.set("dev", "1");
          }
          window.location.assign(url.toString());
        } catch (e) {
          // Fallback query string
          const base = window.location.pathname || "";
          const qs = `?smoketest=1&smokecount=${encodeURIComponent(String(count))}&scenarios=${encodeURIComponent(scenarios.join(","))}${(window.DEV || localStorage.getItem("DEV") === "1") ? "&dev=1" : ""}`;
          try { window.location.href = base + qs; } catch (_) { window.location.search = qs; }
        }
      });
    }
    // Run Linear All: fixed linear order, respects count input
    const runLinearBtn = document.getElementById("smoke-run-linear-btn");
    if (runLinearBtn) {
      runLinearBtn.addEventListener("click", () => {
        // Fixed linear order
        const scenarios = ["world","inventory","dungeon","combat","dungeon_persistence","town","town_diagnostics","overlays","determinism"];
        const countRaw = (this.els.smokeCount && this.els.smokeCount.value) ? this.els.smokeCount.value.trim() : "1";
        const count = Math.max(1, Math.min(20, parseInt(countRaw, 10) || 1));
        try { this.hideSmoke(); } catch (_) {}
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("smoketest", "1");
          url.searchParams.set("smokecount", String(count));
          url.searchParams.set("scenarios", scenarios.join(","));
          if (window.DEV || localStorage.getItem("DEV") === "1") {
            url.searchParams.set("dev", "1");
          }
          window.location.assign(url.toString());
        } catch (e) {
          const base = window.location.pathname || "";
          const qs = `?smoketest=1&smokecount=${encodeURIComponent(String(count))}&scenarios=${encodeURIComponent(scenarios.join(","))}${(window.DEV || localStorage.getItem("DEV") === "1") ? "&dev=1" : ""}`;
          try { window.location.href = base + qs; } catch (_) { window.location.search = qs; }
        }
      });
    }
    if (this.els.smokeCancelBtn) {
      this.els.smokeCancelBtn.addEventListener("click", () => {
        try { this.hideSmoke(); } catch (_) {}
      });
    }

    // Delegate equip slot clicks (unequip)
    this.els.equipSlotsEl?.addEventListener("click", (ev) => {
      const span = ev.target.closest("span.name[data-slot]");
      if (!span) return;
      const slot = span.dataset.slot;
      if (slot && typeof this.handlers.onUnequip === "function") {
        this.handlers.onUnequip(slot);
      }
    });
    // Delegate inventory clicks
    this.els.invPanel?.addEventListener("click", (ev) => {
      const li = ev.target.closest("li");
      if (!li || !li.dataset.index) return;
      const idx = parseInt(li.dataset.index, 10);
      if (!Number.isFinite(idx)) return;
      const kind = li.dataset.kind;
      if (kind === "equip") {
        const slot = li.dataset.slot || "";
        const twoH = li.dataset.twohanded === "true";
        if (twoH) {
          ev.preventDefault();
          if (typeof this.handlers.onEquip === "function") this.handlers.onEquip(idx);
          return;
        }
        if (slot === "hand") {
          ev.preventDefault();
          ev.stopPropagation();
          // If exactly one hand is empty, equip to that hand immediately
          const st = this._equipState || {};
          const leftEmpty = !!st.leftEmpty;
          const rightEmpty = !!st.rightEmpty;
          if (leftEmpty !== rightEmpty) {
            const hand = leftEmpty ? "left" : "right";
            if (typeof this.handlers.onEquipHand === "function") this.handlers.onEquipHand(idx, hand);
            return;
          }
          // Otherwise show hand chooser near the clicked element
          const rect = li.getBoundingClientRect();
          this.showHandChooser(rect.left, rect.bottom + 6, (hand) => {
            if (hand && (hand === "left" || hand === "right")) {
              if (typeof this.handlers.onEquipHand === "function") this.handlers.onEquipHand(idx, hand);
            }
          });
        } else {
          ev.preventDefault();
          if (typeof this.handlers.onEquip === "function") this.handlers.onEquip(idx);
        }
      } else if (kind === "potion" || kind === "drink") {
        ev.preventDefault();
        if (typeof this.handlers.onDrink === "function") this.handlers.onDrink(idx);
      }
    });

    // Hand chooser click
    this.els.handChooser.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      e.stopPropagation(); // prevent outside click handler from firing first
      const hand = btn.dataset.hand;
      const cb = this._handChooserCb;
      this.hideHandChooser();
      if (typeof cb === "function") cb(hand);
    });

    // Hit chooser click
    this.els.hitChooser.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      e.stopPropagation();
      const part = btn.dataset.part;
      const cb = this._hitChooserCb;
      this.hideHitChooser();
      if (typeof cb === "function") cb(part);
    });

    // Confirm dialog click
    this.els.confirm.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.act;
      const okCb = this._confirmOkCb;
      const cancelCb = this._confirmCancelCb;
      this.hideConfirm();
      if (act === "ok" && typeof okCb === "function") okCb();
      else if (act === "cancel" && typeof cancelCb === "function") cancelCb();
    });

    // Town exit button click
    this.els.townExitBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof this.handlers.onTownExit === "function") {
        this.handlers.onTownExit();
      }
    });

    // Hide choosers on any outside click (not in capture phase)
    document.addEventListener("click", (e) => {
      if (this.els.handChooser && this.els.handChooser.style.display !== "none" && !this.els.handChooser.contains(e.target)) {
        this.hideHandChooser();
      }
      if (this.els.hitChooser && this.els.hitChooser.style.display !== "none" && !this.els.hitChooser.contains(e.target)) {
        this.hideHitChooser();
      }
      if (this.els.confirm && this.els.confirm.style.display !== "none" && !this.els.confirm.contains(e.target)) {
        // Treat outside click as cancel
        const cancelCb = this._confirmCancelCb;
        this.hideConfirm();
        if (typeof cancelCb === "function") cancelCb();
      }
    });

    // Fallback keyboard handler to ensure Esc closes panels even if Input.init isn't active
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.isConfirmOpen && this.isConfirmOpen()) {
          this.cancelConfirm && this.cancelConfirm();
          e.preventDefault();
        } else if (this.isInventoryOpen()) {
          this.hideInventory();
          e.preventDefault();
        } else if (this.isGodOpen()) {
          this.hideGod();
          e.preventDefault();
        } else if (this.isSmokeOpen()) {
          this.hideSmoke();
          e.preventDefault();
        } else if (this.isHelpOpen && this.isHelpOpen()) {
          this.hideHelp();
          e.preventDefault();
        } else if (this.isRegionMapOpen && this.isRegionMapOpen()) {
          this.hideRegionMap();
          e.preventDefault();
        }
      }
    });

    // Establish baseline render toggles early to avoid repeated localStorage reads in hot paths.
    try {
      if (typeof window.DRAW_GRID !== "boolean") window.DRAW_GRID = this.getGridState();
      if (typeof window.SHOW_PERF !== "boolean") window.SHOW_PERF = this.getPerfState();
      if (typeof window.SHOW_MINIMAP !== "boolean") window.SHOW_MINIMAP = this.getMinimapState();
      // Ensure buttons reflect baseline state
      this.updateGridButton();
      this.updatePerfButton();
      this.updateMinimapButton();
    } catch (_) {}

    return true;
  },

  showConfirm(text, pos, onOk, onCancel) {
    if (!this.els.confirm) {
      // fallback
      const ans = window.confirm(text || "Are you sure?");
      if (ans && typeof onOk === "function") onOk();
      else if (!ans && typeof onCancel === "function") onCancel();
      return;
    }
    const box = this.els.confirm;
    const p = document.getElementById("ui-confirm-text");
    if (p) p.textContent = text || "Are you sure?";
    this._confirmOkCb = onOk;
    this._confirmCancelCb = onCancel;
    // Default position: center
    let left = Math.round((window.innerWidth - box.offsetWidth) / 2);
    let top = Math.round((window.innerHeight - box.offsetHeight) / 2);
    // Safe handling for optional pos (can be null/undefined)
    const hasPos = pos && typeof pos === "object";
    const x = hasPos && typeof pos.x === "number" ? pos.x : undefined;
    const y = hasPos && typeof pos.y === "number" ? pos.y : undefined;
    if (typeof x === "number" && typeof y === "number") {
      left = Math.max(10, Math.min(window.innerWidth - 300, Math.round(x)));
      top = Math.max(10, Math.min(window.innerHeight - 120, Math.round(y)));
    }
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.display = "block";
  },

  hideConfirm() {
    if (!this.els.confirm) return;
    this.els.confirm.style.display = "none";
    this._confirmOkCb = null;
    this._confirmCancelCb = null;
  },

  isConfirmOpen() {
    return !!(this.els.confirm && this.els.confirm.style.display !== "none");
  },

  cancelConfirm() {
    if (!this.els.confirm) return;
    const cancelCb = this._confirmCancelCb;
    this.hideConfirm();
    if (typeof cancelCb === "function") cancelCb();
  },

  showTownExitButton() {
    if (this.els.townExitBtn) this.els.townExitBtn.style.display = "block";
  },

  hideTownExitButton() {
    if (this.els.townExitBtn) this.els.townExitBtn.style.display = "none";
  },

  setHandlers({ onEquip, onEquipHand, onUnequip, onDrink, onRestart, onWait, onGodHeal, onGodSpawn, onGodSetFov, onGodSetEncounterRate, onGodSpawnEnemy, onGodSpawnStairs, onGodSetAlwaysCrit, onGodSetCritPart, onGodApplySeed, onGodRerollSeed, onTownExit, onGodCheckHomes, onGodCheckInnTavern, onGodCheckSigns, onGodCheckPrefabs, onGodDiagnostics, onGodRunSmokeTest, onGodToggleGrid, onGodApplyBleed, onGodApplyDazed, onGodClearEffects, onGodStartEncounterNow, onGodArmEncounterNextMove } = {}) {
    if (typeof onEquip === "function") this.handlers.onEquip = onEquip;
    if (typeof onEquipHand === "function") this.handlers.onEquipHand = onEquipHand;
    if (typeof onUnequip === "function") this.handlers.onUnequip = onUnequip;
    if (typeof onDrink === "function") this.handlers.onDrink = onDrink;
    if (typeof onRestart === "function") this.handlers.onRestart = onRestart;
    if (typeof onWait === "function") this.handlers.onWait = onWait;
    if (typeof onGodHeal === "function") this.handlers.onGodHeal = onGodHeal;
    if (typeof onGodSpawn === "function") this.handlers.onGodSpawn = onGodSpawn;
    if (typeof onGodSetFov === "function") this.handlers.onGodSetFov = onGodSetFov;
    if (typeof onGodSetEncounterRate === "function") this.handlers.onGodSetEncounterRate = onGodSetEncounterRate;
    if (typeof onGodSpawnEnemy === "function") this.handlers.onGodSpawnEnemy = onGodSpawnEnemy;
    if (typeof onGodSpawnStairs === "function") this.handlers.onGodSpawnStairs = onGodSpawnStairs;
    if (typeof onGodSetAlwaysCrit === "function") this.handlers.onGodSetAlwaysCrit = onGodSetAlwaysCrit;
    if (typeof onGodSetCritPart === "function") this.handlers.onGodSetCritPart = onGodSetCritPart;
    if (typeof onGodApplySeed === "function") this.handlers.onGodApplySeed = onGodApplySeed;
    if (typeof onGodRerollSeed === "function") this.handlers.onGodRerollSeed = onGodRerollSeed;
    if (typeof onTownExit === "function") this.handlers.onTownExit = onTownExit;
    if (typeof onGodCheckHomes === "function") this.handlers.onGodCheckHomes = onGodCheckHomes;
    if (typeof onGodCheckInnTavern === "function") this.handlers.onGodCheckInnTavern = onGodCheckInnTavern;
    if (typeof onGodCheckSigns === "function") this.handlers.onGodCheckSigns = onGodCheckSigns;
    if (typeof onGodCheckPrefabs === "function") this.handlers.onGodCheckPrefabs = onGodCheckPrefabs;
    if (typeof onGodDiagnostics === "function") this.handlers.onGodDiagnostics = onGodDiagnostics;
    if (typeof onGodToggleGrid === "function") this.handlers.onGodToggleGrid = onGodToggleGrid;
    if (typeof onGodApplyBleed === "function") this.handlers.onGodApplyBleed = onGodApplyBleed;
    if (typeof onGodApplyDazed === "function") this.handlers.onGodApplyDazed = onGodApplyDazed;
    if (typeof onGodClearEffects === "function") this.handlers.onGodClearEffects = onGodClearEffects;
    if (typeof onGodStartEncounterNow === "function") this.handlers.onGodStartEncounterNow = onGodStartEncounterNow;
    if (typeof onGodArmEncounterNextMove === "function") this.handlers.onGodArmEncounterNextMove = onGodArmEncounterNextMove;
  },

  updateStats(player, floor, getAtk, getDef, time, perf) {
    // HP + statuses
    if (this.els.hpEl) {
      const parts = [`HP: ${player.hp.toFixed(1)}/${player.maxHp.toFixed(1)}`];
      const statuses = [];
      if (player.bleedTurns && player.bleedTurns > 0) statuses.push(`Bleeding (${player.bleedTurns})`);
      if (player.dazedTurns && player.dazedTurns > 0) statuses.push(`Dazed (${player.dazedTurns})`);
      parts.push(`  Status Effect: ${statuses.length ? statuses.join(", ") : "None"}`);
      const hpStr = parts.join("");
      if (hpStr !== this._lastHpText) {
        this.els.hpEl.textContent = hpStr;
        this._lastHpText = hpStr;
      }
    }
    // Floor + level + XP + time + turn calc ms (always), draw perf (toggle)
    if (this.els.floorEl) {
      const t = time || {};
      const hhmm = t.hhmm || "";
      const phase = t.phase ? t.phase : "";
      const timeStr = hhmm ? `  Time: ${hhmm}${phase ? ` (${phase})` : ""}` : "";
      let turnStr = "";
      if (perf && typeof perf.lastTurnMs === "number") {
        turnStr = `  Turn: ${perf.lastTurnMs.toFixed(1)}ms`;
      }
      // Optional extra perf: show draw time only when Perf HUD is enabled
      let perfStr = "";
      if (this.getPerfState() && perf && (typeof perf.lastDrawMs === "number")) {
        perfStr = `  Draw: ${perf.lastDrawMs.toFixed(1)}ms`;
      }
      const floorStr = `F: ${floor}  Lv: ${player.level}  XP: ${player.xp}/${player.xpNext}${timeStr}${turnStr}${perfStr}`;
      if (floorStr !== this._lastFloorText) {
        this.els.floorEl.textContent = floorStr;
        this._lastFloorText = floorStr;
      }
    }
    // Inventory stats summary
    if (this.els.invStatsEl && typeof getAtk === "function" && typeof getDef === "function") {
      const invStr = `Attack: ${getAtk().toFixed(1)}   Defense: ${getDef().toFixed(1)}`;
      if (invStr !== this._lastInvStatsText) {
        this.els.invStatsEl.textContent = invStr;
        this._lastInvStatsText = invStr;
      }
    }
  },

  renderInventory(player, describeItem) {
    // remember current equip occupancy for quick decisions
    this._equipState = {
      leftEmpty: !(player.equipment && player.equipment.left),
      rightEmpty: !(player.equipment && player.equipment.right),
    };

    // Equipment slots (cache HTML to avoid unnecessary DOM writes)
    if (this.els.equipSlotsEl) {
      const slots = [
        ["left", "Left hand"],
        ["right", "Right hand"],
        ["head", "Head"],
        ["torso", "Torso"],
        ["legs", "Legs"],
        ["hands", "Hands"],
      ];
      const html = slots.map(([key, label]) => {
        const it = player.equipment[key];
        if (it) {
          const name = describeItem(it);
          const dec = Math.max(0, Math.min(100, Number(it.decay || 0)));
          const title = `Decay: ${dec.toFixed(0)}%`;
          return `<div class="slot"><strong>${label}:</strong> <span class="name" data-slot="${key}" title="${title}" style="cursor:pointer; text-decoration:underline dotted;">${name}</span></div>`;
        } else {
          return `<div class="slot"><strong>${label}:</strong> <span class="name"><span class='empty'>(empty)</span></span></div>`;
        }
      }).join("");
      if (html !== this._lastEquipHTML) {
        this.els.equipSlotsEl.innerHTML = html;
        this._lastEquipHTML = html;
      }
    }
    // Inventory list (skip rebuild when unchanged)
    if (this.els.invList) {
      const key = Array.isArray(player.inventory)
        ? player.inventory.map(it => [
            it.kind || "misc",
            it.slot || "",
            it.name || "",
            (typeof it.atk === "number" ? it.atk : ""),
            (typeof it.def === "number" ? it.def : ""),
            (typeof it.decay === "number" ? it.decay : ""),
            (typeof it.count === "number" ? it.count : ""),
            (typeof it.amount === "number" ? it.amount : "")
          ].join("|")).join(";;")
        : "";
      if (key !== this._lastInvListKey) {
        this.els.invList.innerHTML = "";
        player.inventory.forEach((it, idx) => {
          const li = document.createElement("li");
          li.dataset.index = String(idx);
          li.dataset.kind = it.kind || "misc";

          // Build display label with counts/stats where helpful
          const baseLabel = (typeof describeItem === "function")
            ? describeItem(it)
            : ((typeof window !== "undefined" && window.ItemDescribe && typeof window.ItemDescribe.describe === "function")
                ? window.ItemDescribe.describe(it)
                : (it.name || "item"));
          let label = baseLabel;

          if (it.kind === "potion" || it.kind === "drink") {
            const count = (it.count && it.count > 1) ? ` x${it.count}` : "";
            label = `${baseLabel}${count}`;
          } else if (it.kind === "gold") {
            const amount = Number(it.amount || 0);
            label = `${baseLabel}: ${amount}`;
          } else if (it.kind === "equip") {
            const stats = [];
            if (typeof it.atk === "number") stats.push(`+${Number(it.atk).toFixed(1)} atk`);
            if (typeof it.def === "number") stats.push(`+${Number(it.def).toFixed(1)} def`);
            if (stats.length) label = `${baseLabel} (${stats.join(", ")})`;
          }

          if (it.kind === "equip" && it.slot === "hand") {
            li.dataset.slot = "hand";
            const dec = Math.max(0, Math.min(100, Number(it.decay || 0)));
            if (it.twoHanded) {
              li.dataset.twohanded = "true";
              li.title = `Two-handed • Decay: ${dec.toFixed(0)}%`;
            } else {
              // If exactly one hand is empty, hint which one will be used automatically
              let autoHint = "";
              if (this._equipState) {
                if (this._equipState.leftEmpty && !this._equipState.rightEmpty) autoHint = " (Left is empty)";
                else if (this._equipState.rightEmpty && !this._equipState.leftEmpty) autoHint = " (Right is empty)";
              }
              li.title = `Click to equip${autoHint ? autoHint : " (choose hand)"} • Decay: ${dec.toFixed(0)}%`;
            }
            li.style.cursor = "pointer";
          } else if (it.kind === "equip") {
            li.dataset.slot = it.slot || "";
            const dec = Math.max(0, Math.min(100, Number(it.decay || 0)));
            li.title = `Click to equip • Decay: ${dec.toFixed(0)}%`;
            li.style.cursor = "pointer";
          } else if (it.kind === "potion" || it.kind === "drink") {
            li.style.cursor = "pointer";
            li.title = "Click to drink";
          } else {
            li.style.opacity = "0.7";
            li.style.cursor = "default";
          }

          li.textContent = label;
          this.els.invList.appendChild(li);
        });
        this._lastInvListKey = key;
      }
    }
  },

  showInventory() {
    if (this.els.lootPanel && !this.els.lootPanel.hidden) this.hideLoot();
    if (this.els.invPanel) this.els.invPanel.hidden = false;
  },

  hideInventory() {
    if (this.els.invPanel) this.els.invPanel.hidden = true;
  },

  isInventoryOpen() {
    return !!(this.els.invPanel && !this.els.invPanel.hidden);
  },

  showHandChooser(x, y, cb) {
    if (!this.els.handChooser) return;
    this._handChooserCb = cb;
    this.els.handChooser.style.left = `${Math.round(x)}px`;
    this.els.handChooser.style.top = `${Math.round(y)}px`;
    this.els.handChooser.style.display = "block";
  },

  hideHandChooser() {
    if (!this.els.handChooser) return;
    this.els.handChooser.style.display = "none";
    this._handChooserCb = null;
  },

  showHitChooser(x, y, cb) {
    if (!this.els.hitChooser) return;
    this._hitChooserCb = cb;
    this.els.hitChooser.style.left = `${Math.round(x)}px`;
    this.els.hitChooser.style.top = `${Math.round(y)}px`;
    this.els.hitChooser.style.display = "block";
  },

  hideHitChooser() {
    if (!this.els.hitChooser) return;
    this.els.hitChooser.style.display = "none";
    this._hitChooserCb = null;
  },

  showLoot(list) {
    if (!this.els.lootPanel || !this.els.lootList) return;
    this.els.lootList.innerHTML = "";
    list.forEach(name => {
      const li = document.createElement("li");
      li.textContent = name;
      this.els.lootList.appendChild(li);
    });
    this.els.lootPanel.hidden = false;
  },

  hideLoot() {
    if (!this.els.lootPanel) return;
    this.els.lootPanel.hidden = true;
  },

  isLootOpen() {
    return !!(this.els.lootPanel && !this.els.lootPanel.hidden);
  },

  // GOD mode modal
  showGod() {
    if (this.isLootOpen()) this.hideLoot();
    if (this.isInventoryOpen()) this.hideInventory();
    if (this.isSmokeOpen()) this.hideSmoke();
    if (this.els.godPanel) this.els.godPanel.hidden = false;
  },

  hideGod() {
    if (this.els.godPanel) this.els.godPanel.hidden = true;
  },

  isGodOpen() {
    return !!(this.els.godPanel && !this.els.godPanel.hidden);
  },

  // ---- Region Map modal ----
  showRegionMap(ctx = null) {
    // Close other modals for clarity
    if (this.isLootOpen()) this.hideLoot();
    if (this.isInventoryOpen()) this.hideInventory();
    if (this.isGodOpen()) this.hideGod();
    if (this.isSmokeOpen()) this.hideSmoke();
    try { RegionModal.show(ctx); } catch (_) {}
  },

  hideRegionMap() {
    try { RegionModal.hide(); } catch (_) {}
  },

  isRegionMapOpen() {
    try { return !!RegionModal.isOpen(); } catch (_) { return false; }
  },

  // ---- Help / Controls + Character Sheet (F1) ----
  showHelp(ctx = null) {
    // Close other modals for clarity
    if (this.isLootOpen()) this.hideLoot();
    if (this.isInventoryOpen()) this.hideInventory();
    if (this.isGodOpen()) this.hideGod();
    if (this.isSmokeOpen()) this.hideSmoke();
    if (this.isRegionMapOpen()) this.hideRegionMap();
    try { HelpModal.show(ctx); } catch (_) {}
  },

  hideHelp() {
    try { HelpModal.hide(); } catch (_) {}
  },

  isHelpOpen() {
    try { return !!HelpModal.isOpen(); } catch (_) { return false; }
  },

  // --- Encounter rate controls (0..100) ---
  getEncounterRateState() {
    // Default 50 means baseline frequency; &lt;50 fewer, &gt;50 more
    try {
      if (typeof window.ENCOUNTER_RATE === "number" && Number.isFinite(window.ENCOUNTER_RATE)) {
        const v = Math.max(0, Math.min(100, Math.round(Number(window.ENCOUNTER_RATE))));
        return v;
      }
      const raw = localStorage.getItem("ENCOUNTER_RATE");
      if (raw != null) {
        const v = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
        return v;
      }
    } catch (_) {}
    // Config-driven default (Phase 5)
    try {
      const cfg = (typeof window !== "undefined" && window.GameData && window.GameData.config && window.GameData.config.dev) ? window.GameData.config.dev : null;
      const v = (cfg && typeof cfg.encounterRateDefault === "number") ? Math.max(0, Math.min(100, Math.round(Number(cfg.encounterRateDefault) || 0))) : 50;
      return v;
    } catch (_) {}
    return 50;
  },

  setEncounterRateState(val) {
    const v = Math.max(0, Math.min(100, Math.round(Number(val) || 0)));
    try {
      window.ENCOUNTER_RATE = v;
      localStorage.setItem("ENCOUNTER_RATE", String(v));
    } catch (_) {}
    this.updateEncounterRateUI();
  },

  updateEncounterRateUI() {
    const v = this.getEncounterRateState();
    if (this.els.godEncRate) this.els.godEncRate.value = String(v);
    if (this.els.godEncRateValue) this.els.godEncRateValue.textContent = `Encounter rate: ${v}`;
  },

  // --- Side log mirror controls ---
  getSideLogState() {
    try {
      if (typeof window.LOG_MIRROR === "boolean") return window.LOG_MIRROR;
      const m = localStorage.getItem("LOG_MIRROR");
      if (m === "1") return true;
      if (m === "0") return false;
    } catch (_) {}
    return true; // default on
  },

  setSideLogState(enabled) {
    try {
      window.LOG_MIRROR = !!enabled;
      localStorage.setItem("LOG_MIRROR", enabled ? "1" : "0");
    } catch (_) {}
    // Apply immediately
    try {
      if (typeof window !== "undefined" && window.Logger && typeof window.Logger.init === "function") {
        window.Logger.init();
      }
    } catch (_) {}
    // Ensure DOM reflects the state even without reinit
    const el = document.getElementById("log-right");
    if (el) {
      el.style.display = enabled ? "" : "none";
    }
    this.updateSideLogButton();
  },

  toggleSideLog() {
    const cur = this.getSideLogState();
    this.setSideLogState(!cur);
  },

  updateSideLogButton() {
    if (!this.els.godToggleMirrorBtn) return;
    const on = this.getSideLogState();
    this.els.godToggleMirrorBtn.textContent = `Side Log: ${on ? "On" : "Off"}`;
    this.els.godToggleMirrorBtn.title = on ? "Hide side log" : "Show side log";
  },

  // --- Render grid controls ---
  getGridState() {
    try {
      if (typeof window.DRAW_GRID === "boolean") return window.DRAW_GRID;
      const v = localStorage.getItem("DRAW_GRID");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    // Default OFF on small screens/low-power devices to reduce draw overhead
    try {
      const smallScreen = (typeof window !== "undefined" && window.innerWidth && window.innerWidth < 700);
      const hc = (typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number") ? navigator.hardwareConcurrency : 4;
      const dm = (typeof navigator !== "undefined" && typeof navigator.deviceMemory === "number") ? navigator.deviceMemory : 4;
      return !(smallScreen || hc <= 4 || dm <= 4) ? true : false;
    } catch (_) {}
    return false;
  },

  setGridState(enabled) {
    try {
      window.DRAW_GRID = !!enabled;
      localStorage.setItem("DRAW_GRID", enabled ? "1" : "0");
    } catch (_) {}
    this.updateGridButton();
  },

  updateGridButton() {
    if (!this.els.godToggleGridBtn) return;
    const on = this.getGridState();
    this.els.godToggleGridBtn.textContent = `Grid: ${on ? "On" : "Off"}`;
  },

  // --- Perf overlay controls ---
  getPerfState() {
    try {
      if (typeof window.SHOW_PERF === "boolean") return window.SHOW_PERF;
      const v = localStorage.getItem("SHOW_PERF");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    // Default OFF on small screens/low-power devices to keep HUD lean
    try {
      const smallScreen = (typeof window !== "undefined" && window.innerWidth && window.innerWidth < 700);
      const hc = (typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number") ? navigator.hardwareConcurrency : 4;
      const dm = (typeof navigator !== "undefined" && typeof navigator.deviceMemory === "number") ? navigator.deviceMemory : 4;
      return !(smallScreen || hc <= 4 || dm <= 4) ? true : false;
    } catch (_) {}
    return false;
  },

  setPerfState(enabled) {
    try {
      window.SHOW_PERF = !!enabled;
      localStorage.setItem("SHOW_PERF", enabled ? "1" : "0");
    } catch (_) {}
    this.updatePerfButton();
    try {
      const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.requestDraw === "function") {
        UIO.requestDraw(null);
      } else if (typeof window !== "undefined" && window.GameLoop && typeof window.GameLoop.requestDraw === "function") {
        window.GameLoop.requestDraw();
      }
    } catch (_) {}
  },

  updatePerfButton() {
    if (!this.els.godTogglePerfBtn) return;
    const on = this.getPerfState();
    this.els.godTogglePerfBtn.textContent = `Perf: ${on ? "On" : "Off"}`;
    this.els.godTogglePerfBtn.title = on ? "Hide performance timings in HUD" : "Show performance timings in HUD";
  },

  // ---- Smoke Test Configuration modal ----
  showSmoke() {
    if (this.isLootOpen()) this.hideLoot();
    if (this.isInventoryOpen()) this.hideInventory();
    if (this.isGodOpen()) this.hideGod();
    // Build options on open to reflect any future changes
    try { this.renderSmokeOptions(); } catch (_) {}
    try { SmokeModal.show(); } catch (_) {}
  },

  hideSmoke() {
    try { SmokeModal.hide(); } catch (_) {}
  },

  isSmokeOpen() {
    try { return !!SmokeModal.isOpen(); } catch (_) { return false; }
  },

  // --- Minimap controls ---
  getMinimapState() {
    try {
      if (typeof window.SHOW_MINIMAP === "boolean") return window.SHOW_MINIMAP;
      const v = localStorage.getItem("SHOW_MINIMAP");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    // Default OFF (user can enable via GOD panel or localStorage)
    return false;
  },

  setMinimapState(enabled) {
    try {
      window.SHOW_MINIMAP = !!enabled;
      localStorage.setItem("SHOW_MINIMAP", enabled ? "1" : "0");
    } catch (_) {}
    this.updateMinimapButton();
    try {
      const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.requestDraw === "function") {
        UIO.requestDraw(null);
      } else if (typeof window !== "undefined" && window.GameLoop && typeof window.GameLoop.requestDraw === "function") {
        window.GameLoop.requestDraw();
      }
    } catch (_) {}
  },

  updateMinimapButton() {
    if (!this.els.godToggleMinimapBtn) return;
    const on = this.getMinimapState();
    this.els.godToggleMinimapBtn.textContent = `Minimap: ${on ? "On" : "Off"}`;
    this.els.godToggleMinimapBtn.title = on ? "Hide overworld minimap" : "Show overworld minimap";
  },

  
  

  // --- Town debug overlay controls ---
  getTownOverlayState() {
    try {
      if (typeof window.DEBUG_TOWN_OVERLAY === "boolean") return window.DEBUG_TOWN_OVERLAY;
      const v = localStorage.getItem("DEBUG_TOWN_OVERLAY");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    return false;
  },

  setTownOverlayState(enabled) {
    try {
      window.DEBUG_TOWN_OVERLAY = !!enabled;
      localStorage.setItem("DEBUG_TOWN_OVERLAY", enabled ? "1" : "0");
    } catch (_) {}
    this.updateTownOverlayButton();
  },

  updateTownOverlayButton() {
    if (!this.els.godToggleTownOverlayBtn) return;
    const on = this.getTownOverlayState();
    this.els.godToggleTownOverlayBtn.textContent = `Overlay: ${on ? "On" : "Off"}`;
    this.els.godToggleTownOverlayBtn.title = on ? "Hide occupied-house and NPC target overlay" : "Show occupied houses and NPC targets in town";
  },

  // --- Town path debug controls ---
  getTownPathsState() {
    try {
      if (typeof window.DEBUG_TOWN_PATHS === "boolean") return window.DEBUG_TOWN_PATHS;
      const v = localStorage.getItem("DEBUG_TOWN_PATHS");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    return false;
  },

  setTownPathsState(enabled) {
    try {
      window.DEBUG_TOWN_PATHS = !!enabled;
      localStorage.setItem("DEBUG_TOWN_PATHS", enabled ? "1" : "0");
    } catch (_) {}
    this.updateTownPathsButton();
  },

  updateTownPathsButton() {
    if (!this.els.godToggleTownPathsBtn) return;
    const on = this.getTownPathsState();
    this.els.godToggleTownPathsBtn.textContent = `Paths: ${on ? "On" : "Off"}`;
    this.els.godToggleTownPathsBtn.title = on ? "Hide NPC planned paths" : "Show NPC planned paths (town only)";
  },

  // --- Home path debug controls ---
  getHomePathsState() {
    try {
      if (typeof window.DEBUG_TOWN_HOME_PATHS === "boolean") return window.DEBUG_TOWN_HOME_PATHS;
      const v = localStorage.getItem("DEBUG_TOWN_HOME_PATHS");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    // Default OFF to reduce render overhead; users can enable via toggle
    return false;
  },

  setHomePathsState(enabled) {
    try {
      window.DEBUG_TOWN_HOME_PATHS = !!enabled;
      localStorage.setItem("DEBUG_TOWN_HOME_PATHS", enabled ? "1" : "0");
    } catch (_) {}
    this.updateHomePathsButton();
  },

  updateHomePathsButton() {
    if (!this.els.godToggleHomePathsBtn) return;
    const on = this.getHomePathsState();
    this.els.godToggleHomePathsBtn.textContent = `Home Paths: ${on ? "On" : "Off"}`;
    this.els.godToggleHomePathsBtn.title = on ? "Hide NPC home paths (blue)" : "Show full NPC home paths in blue (town only)";
  },

  // --- Route path debug controls (current destination) ---
  getRoutePathsState() {
    try {
      if (typeof window.DEBUG_TOWN_ROUTE_PATHS === "boolean") return window.DEBUG_TOWN_ROUTE_PATHS;
      const v = localStorage.getItem("DEBUG_TOWN_ROUTE_PATHS");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    return false;
  },

  setRoutePathsState(enabled) {
    try {
      window.DEBUG_TOWN_ROUTE_PATHS = !!enabled;
      localStorage.setItem("DEBUG_TOWN_ROUTE_PATHS", enabled ? "1" : "0");
    } catch (_) {}
    this.updateRoutePathsButton();
  },

  updateRoutePathsButton() {
    if (!this.els.godToggleRoutePathsBtn) return;
    const on = this.getRoutePathsState();
    this.els.godToggleRoutePathsBtn.textContent = `Routes: ${on ? "On" : "Off"}`;
    this.els.godToggleRoutePathsBtn.title = on ? "Hide NPC current-destination routes (blue)" : "Show NPC current-destination routes in blue (town only)";
  },

  // --- Always Crit controls ---
  getAlwaysCritState() {
    try {
      if (typeof window.ALWAYS_CRIT === "boolean") return window.ALWAYS_CRIT;
      const v = localStorage.getItem("ALWAYS_CRIT");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    return false;
  },

  setAlwaysCritState(enabled) {
    try {
      window.ALWAYS_CRIT = !!enabled;
      localStorage.setItem("ALWAYS_CRIT", enabled ? "1" : "0");
    } catch (_) {}
    // When disabling, also clear any forced crit part to avoid stale display/state
    if (!enabled) {
      this.setCritPartState("");
    }
    this.updateAlwaysCritButton();
  },

  getCritPartState() {
    try {
      if (typeof window.ALWAYS_CRIT_PART === "string" && window.ALWAYS_CRIT_PART) return window.ALWAYS_CRIT_PART;
      const v = localStorage.getItem("ALWAYS_CRIT_PART");
      if (v) return v;
    } catch (_) {}
    return "";
  },

  setCritPartState(part) {
    try {
      window.ALWAYS_CRIT_PART = part || "";
      if (part) localStorage.setItem("ALWAYS_CRIT_PART", part);
      else localStorage.removeItem("ALWAYS_CRIT_PART");
    } catch (_) {}
    this.updateAlwaysCritButton();
  },

  updateAlwaysCritButton() {
    if (!this.els.godToggleCritBtn) return;
    const on = this.getAlwaysCritState();
    const part = this.getCritPartState();
    this.els.godToggleCritBtn.textContent = `Always Crit: ${on ? "On" : "Off"}${on && part ? ` (${part})` : ""}`;
  },

  // --- RNG UI ---
  getSeedState() {
    try {
      const v = localStorage.getItem("SEED");
      return v || "";
    } catch (_) {}
    return "";
  },

  updateSeedUI() {
    const seed = this.getSeedState();
    // Always reflect persisted seed into UI on init to avoid stale values
    if (this.els.godSeedInput) {
      this.els.godSeedInput.value = seed;
    }
    if (this.els.godSeedHelp) {
      this.els.godSeedHelp.textContent = seed ? `Current seed: ${seed}` : "Current seed: (random)";
    }
  },

  showGameOver(player, floor) {
    if (this.els.lootPanel && !this.els.lootPanel.hidden) this.hideLoot();
    if (!this.els.gameOverPanel) return;
    const gold = (player.inventory.find(i => i.kind === "gold")?.amount) || 0;
    if (this.els.gameOverSummary) {
      this.els.gameOverSummary.textContent = `You died on floor ${floor} (Lv ${player.level}). Gold: ${gold}. XP: ${player.xp}/${player.xpNext}.`;
    }
    this.els.gameOverPanel.hidden = false;
  },

  hideGameOver() {
    if (!this.els.gameOverPanel) return;
    this.els.gameOverPanel.hidden = true;
  }
};

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("UI", UI);