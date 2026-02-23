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

import * as HelpModal from "/ui/components/help_modal.js";
import * as CharacterModal from "/ui/components/character_modal.js";
import * as FollowerModal from "/ui/components/follower_modal.js";

import * as SmokeModal from "/ui/components/smoke_modal.js";
import * as ConfirmModal from "/ui/components/confirm_modal.js";
import * as HandChooser from "/ui/components/hand_chooser.js";
import * as HitChooser from "/ui/components/hit_chooser.js";
import * as GameOverModal from "/ui/components/game_over_modal.js";

import * as GodPanel from "/ui/components/god_panel.js";
import * as InventoryPanel from "/ui/components/inventory_panel.js";
import * as LootPanel from "/ui/components/loot_panel.js";
import * as Hud from "/ui/components/hud.js";
import * as SandboxPanel from "/ui/components/sandbox_panel_v2.js";
import * as GMPanel from "/ui/components/gm_panel.js";

export const UI = {
  GMPanel,
  els: {},
  handlers: {
    onEquip: null,
    onEquipHand: null,
    onUnequip: null,
    onDrink: null,
    onEat: null,
    onUse: null,
    onRestart: null,
    onWait: null,
    onGodHeal: null,
    onGodSpawn: null,
    onGodSetFov: null,
    onGodSetEncounterRate: null,
    onGodSpawnEnemy: null,
    onGodSpawnStairs: null,
    onGodHireFollower: null,
    // Town events
    onGodTownBandits: null,
    // World teleport helpers
    onGodTeleportToTower: null,
    onGodTeleport: null,
    // Sandbox helpers
    onGodEnterSandbox: null,
    onToggleSandboxPanel: null,
    // GM sim tools
    onGodRunGmEmissionSim: null,
    onGodCopyGmEmissionSim: null,
  },

  init() {
    this.els.hpEl = document.getElementById("health");
    this.els.floorEl = document.getElementById("floor");
    try { if (Hud && typeof Hud.init === "function") Hud.init(); } catch (_) {}
    this.els.logEl = document.getElementById("log");
    this.els.lootPanel = document.getElementById("loot-panel");
    this.els.lootList = document.getElementById("loot-list");
    try { if (LootPanel && typeof LootPanel.init === "function") LootPanel.init(); } catch (_) {}
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
    this.els.godToggleInvincibleBtn = document.getElementById("god-toggle-invincible-btn");
    this.els.godToggleGridBtn = document.getElementById("god-toggle-grid-btn");
    // Additional GOD toggle buttons (needed for updating button labels/titles)
    this.els.godTogglePerfBtn = document.getElementById("god-toggle-perf-btn");
    this.els.godToggleMinimapBtn = document.getElementById("god-toggle-minimap-btn");
    // HUD toggles
    this.els.godToggleOverworldHudBtn = document.getElementById("god-toggle-ow-hud-btn");
    this.els.godToggleRegionHudBtn = document.getElementById("god-toggle-region-hud-btn");
    this.els.godToggleEncounterHudBtn = document.getElementById("god-toggle-enc-hud-btn");
    // Town debug overlays
    this.els.godToggleTownOverlayBtn = document.getElementById("god-toggle-town-overlay-btn");
    this.els.godToggleTownPathsBtn = document.getElementById("god-toggle-town-paths-btn");
    this.els.godToggleHomePathsBtn = document.getElementById("god-toggle-home-paths-btn");
    this.els.godToggleRoutePathsBtn = document.getElementById("god-toggle-route-paths-btn");
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

    // GOD panel wiring moved to component
    try { if (GodPanel && typeof GodPanel.init === "function") GodPanel.init(this); } catch (_) {}
    // Sandbox controls panel (F10, sandbox-only)
    try { if (SandboxPanel && typeof SandboxPanel.init === "function") SandboxPanel.init(this); } catch (_) {}
    // GM overlay (O) – non-blocking debug panel
    try { if (GMPanel && typeof GMPanel.init === "function") GMPanel.init(this); } catch (_) {}
    // Inventory panel wiring moved to component
    try { if (InventoryPanel && typeof InventoryPanel.init === "function") InventoryPanel.init(this); } catch (_) {}
    this.updateSeedUI();
    this.updateEncounterRateUI();

    // Smoke config buttons
    if (this.els.smokeRunBtn) {
      this.els.smokeRunBtn.addEventListener("click", () => {
        // Collect selected scenarios
        const boxes = (this.els.smokeList ? Array.from(this.els.smokeList.querySelectorAll("input.smoke-sel")) : []);
        const sel = boxes.filter(b => b.checked).map(b => b.value);
        // Fallback: all scenarios if none selected
        const scenarios = sel.length ? sel : ["world","region","dungeon","inventory","combat","dungeon_persistence","town","town_diagnostics","overlays","determinism"];
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
        const scenarios = ["world","region","inventory","dungeon","combat","dungeon_persistence","town","town_diagnostics","overlays","determinism"];
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
        } else if (this.isCharacterOpen && this.isCharacterOpen()) {
          this.hideCharacter();
          e.preventDefault();
        } else if (this.isFollowerOpen && this.isFollowerOpen()) {
          this.hideFollower();
          e.preventDefault();
        }
      }
    });

    // Establish baseline render toggles early to avoid repeated localStorage reads in hot paths.
    try {
      if (typeof window.DRAW_GRID !== "boolean") window.DRAW_GRID = this.getGridState();
      if (typeof window.SHOW_PERF !== "boolean") window.SHOW_PERF = this.getPerfState();
      if (typeof window.SHOW_MINIMAP !== "boolean") window.SHOW_MINIMAP = this.getMinimapState();
      if (typeof window.MINIMAP_FULL !== "boolean") window.MINIMAP_FULL = this.getMinimapFullState();
      // HUD toggles baselines
      if (typeof window.SHOW_OVERWORLD_HUD !== "boolean") window.SHOW_OVERWORLD_HUD = this.getOverworldHudState();
      if (typeof window.SHOW_REGION_HUD !== "boolean") window.SHOW_REGION_HUD = this.getRegionHudState();
      if (typeof window.SHOW_ENCOUNTER_HUD !== "boolean") window.SHOW_ENCOUNTER_HUD = this.getEncounterHudState();
      // Ensure buttons reflect baseline state
      this.updateGridButton();
      this.updatePerfButton();
      this.updateMinimapButton();
      this.updateOverworldHudButton();
      this.updateRegionHudButton();
      this.updateEncounterHudButton();
    } catch (_) {}

    return true;
  },

  showConfirm(text, pos, onOk, onCancel) {
    try { ConfirmModal.show(text, pos, onOk, onCancel); } catch (_) {}
  },

  hideConfirm() {
    try { ConfirmModal.hide(); } catch (_) {}
  },

  isConfirmOpen() {
    try { return !!ConfirmModal.isOpen(); } catch (_) { return false; }
  },

  cancelConfirm() {
    try { ConfirmModal.cancel(); } catch (_) {}
  },

  

  setHandlers({ onEquip, onEquipHand, onUnequip, onDrink, onEat, onUse, onRestart, onWait, onGodHeal, onGodSpawn, onGodSetFov, onGodSetEncounterRate, onGodSpawnEnemy, onGodSpawnStairs, onGodHireFollower, onGodSetAlwaysCrit, onGodSetCritPart, onGodToggleInvincible, onGodApplySeed, onGodRerollSeed, onGodCheckHomes, onGodCheckInnTavern, onGodCheckSigns, onGodCheckPrefabs, onGodDiagnostics, onGodRunSmokeTest, onGodRunValidation, onGodToggleGrid, onGodApplyBleed, onGodApplyDazed, onGodClearEffects, onGodStartEncounterNow, onGodArmEncounterNextMove, onGodTownBandits, onGodTeleportToTower, onGodTeleport, onGodEnterSandbox, onToggleSandboxPanel, onGodRunGmEmissionSim, onGodCopyGmEmissionSim } = {}) {
    if (typeof onEquip === "function") this.handlers.onEquip = onEquip;
    if (typeof onEquipHand === "function") this.handlers.onEquipHand = onEquipHand;
    if (typeof onUnequip === "function") this.handlers.onUnequip = onUnequip;
    if (typeof onDrink === "function") this.handlers.onDrink = onDrink;
    if (typeof onEat === "function") this.handlers.onEat = onEat;
    if (typeof onUse === "function") this.handlers.onUse = onUse;
    if (typeof onRestart === "function") this.handlers.onRestart = onRestart;
    if (typeof onWait === "function") this.handlers.onWait = onWait;
    if (typeof onGodHeal === "function") this.handlers.onGodHeal = onGodHeal;
    if (typeof onGodSpawn === "function") this.handlers.onGodSpawn = onGodSpawn;
    if (typeof onGodSetFov === "function") this.handlers.onGodSetFov = onGodSetFov;
    if (typeof onGodSetEncounterRate === "function") this.handlers.onGodSetEncounterRate = onGodSetEncounterRate;
    if (typeof onGodSpawnEnemy === "function") this.handlers.onGodSpawnEnemy = onGodSpawnEnemy;
    if (typeof onGodSpawnStairs === "function") this.handlers.onGodSpawnStairs = onGodSpawnStairs;
    if (typeof onGodHireFollower === "function") this.handlers.onGodHireFollower = onGodHireFollower;
    if (typeof onGodSetAlwaysCrit === "function") this.handlers.onGodSetAlwaysCrit = onGodSetAlwaysCrit;
    if (typeof onGodSetCritPart === "function") this.handlers.onGodSetCritPart = onGodSetCritPart;
    if (typeof onGodToggleInvincible === "function") this.handlers.onGodToggleInvincible = onGodToggleInvincible;
    if (typeof onGodApplySeed === "function") this.handlers.onGodApplySeed = onGodApplySeed;
    if (typeof onGodRerollSeed === "function") this.handlers.onGodRerollSeed = onGodRerollSeed;
    if (typeof onGodCheckHomes === "function") this.handlers.onGodCheckHomes = onGodCheckHomes;
    if (typeof onGodCheckInnTavern === "function") this.handlers.onGodCheckInnTavern = onGodCheckInnTavern;
    if (typeof onGodCheckSigns === "function") this.handlers.onGodCheckSigns = onGodCheckSigns;
    if (typeof onGodCheckPrefabs === "function") this.handlers.onGodCheckPrefabs = onGodCheckPrefabs;
    if (typeof onGodDiagnostics === "function") this.handlers.onGodDiagnostics = onGodDiagnostics;
    if (typeof onGodRunValidation === "function") this.handlers.onGodRunValidation = onGodRunValidation;
    if (typeof onGodToggleGrid === "function") this.handlers.onGodToggleGrid = onGodToggleGrid;
    if (typeof onGodApplyBleed === "function") this.handlers.onGodApplyBleed = onGodApplyBleed;
    if (typeof onGodApplyDazed === "function") this.handlers.onGodApplyDazed = onGodApplyDazed;
    if (typeof onGodClearEffects === "function") this.handlers.onGodClearEffects = onGodClearEffects;
    if (typeof onGodStartEncounterNow === "function") this.handlers.onGodStartEncounterNow = onGodStartEncounterNow;
    if (typeof onGodArmEncounterNextMove === "function") this.handlers.onGodArmEncounterNextMove = onGodArmEncounterNextMove;
    if (typeof onGodTownBandits === "function") this.handlers.onGodTownBandits = onGodTownBandits;
    if (typeof onGodTeleportToTower === "function") this.handlers.onGodTeleportToTower = onGodTeleportToTower;
    if (typeof onGodTeleport === "function") this.handlers.onGodTeleport = onGodTeleport;
    if (typeof onGodRunGmEmissionSim === "function") this.handlers.onGodRunGmEmissionSim = onGodRunGmEmissionSim;
    if (typeof onGodCopyGmEmissionSim === "function") this.handlers.onGodCopyGmEmissionSim = onGodCopyGmEmissionSim;

    // Extra handlers (added later) for applying status effects or sandbox actions via GOD panel.
    const extra = arguments[0] || {};
    if (typeof extra.onGodApplyStatusEffect === "function") {
      this.handlers.onGodApplyStatusEffect = extra.onGodApplyStatusEffect;
    }
    if (typeof extra.onGodEnterSandbox === "function") {
      this.handlers.onGodEnterSandbox = extra.onGodEnterSandbox;
    }
    if (typeof extra.onToggleSandboxPanel === "function") {
      this.handlers.onToggleSandboxPanel = extra.onToggleSandboxPanel;
    }
  },

  // HUD + inventory stats
  updateStats(player, floor, getAtk, getDef, time, perf, weather) {
    // Delegate HUD (HP/Floor/Time/Perf/Weather) to component
    try {
      if (Hud && typeof Hud.update === "function") {
        Hud.update(player, floor, time, perf, this.getPerfState(), weather);
      }
    } catch (_) {}

    // Inventory stats summary (Attack/Defense) in the inventory panel header
    if (this.els.invStatsEl && typeof getAtk === "function" && typeof getDef === "function") {
      let atkVal = 0;
      let defVal = 0;
      try { atkVal = Number(getAtk() || 0); } catch (_) {}
      try { defVal = Number(getDef() || 0); } catch (_) {}
      const invStr = `Attack: ${atkVal.toFixed(1)}   Defense: ${defVal.toFixed(1)}`;
      if (invStr !== this._lastInvStatsText) {
        this.els.invStatsEl.textContent = invStr;
        this._lastInvStatsText = invStr;
      }
    }
  },

  renderInventory(player, describeItem) {
    try { InventoryPanel.render(player, describeItem); } catch (_) {}
  },

  showInventory() {
    if (this.isLootOpen()) this.hideLoot();
    try { InventoryPanel.show(); } catch (_) { if (this.els.invPanel) this.els.invPanel.hidden = false; }
  },

  hideInventory() {
    try { InventoryPanel.hide(); } catch (_) { if (this.els.invPanel) this.els.invPanel.hidden = true; }
  },

  isInventoryOpen() {
    try { return !!InventoryPanel.isOpen(); } catch (_) { return !!(this.els.invPanel && !this.els.invPanel.hidden); }
  },

  showHandChooser(x, y, cb) {
    try { HandChooser.show(x, y, cb); } catch (_) {}
  },

  hideHandChooser() {
    try { HandChooser.hide(); } catch (_) {}
  },

  showHitChooser(x, y, cb) {
    try { HitChooser.show(x, y, cb); } catch (_) {}
  },

  hideHitChooser() {
    try { HitChooser.hide(); } catch (_) {}
  },

  showLoot(list) {
    try { LootPanel.show(list || []); } catch (_) {
      if (!this.els.lootPanel || !this.els.lootList) return;
      this.els.lootList.innerHTML = "";
      (list || []).forEach(name => {
        const li = document.createElement("li");
        li.textContent = String(name || "");
        this.els.lootList.appendChild(li);
      });
      this.els.lootPanel.hidden = false;
    }
  },

  hideLoot() {
    try { LootPanel.hide(); } catch (_) {
      if (!this.els.lootPanel) return;
      this.els.lootPanel.hidden = true;
    }
  },

  isLootOpen() {
    try { return !!LootPanel.isOpen(); } catch (_) {
      return !!(this.els.lootPanel && !this.els.lootPanel.hidden);
    }
  },

  // GOD mode modal
  showGod() {
    if (this.isLootOpen()) this.hideLoot();
    if (this.isInventoryOpen()) this.hideInventory();
    if (this.isSmokeOpen()) this.hideSmoke();
    try { GodPanel.show(); } catch (_) { if (this.els.godPanel) this.els.godPanel.hidden = false; }
  },

  hideGod() {
    try { GodPanel.hide(); } catch (_) { if (this.els.godPanel) this.els.godPanel.hidden = true; }
  },

  isGodOpen() {
    try { return !!GodPanel.isOpen(); } catch (_) { return !!(this.els.godPanel && !this.els.godPanel.hidden); }
  },

  // Update FOV value label and slider position
  setGodFov(val) {
    try {
      if (this.els.godFovValue) this.els.godFovValue.textContent = `FOV: ${val}`;
      if (this.els.godFov) this.els.godFov.value = String(val);
    } catch (_) {}
  },

  

  // ---- Help / Controls + Character Sheet (F1) ----
  showHelp(ctx = null) {
    // Close other modals for clarity
    if (this.isLootOpen()) this.hideLoot();
    if (this.isInventoryOpen()) this.hideInventory();
    if (this.isGodOpen()) this.hideGod();
    if (this.isSmokeOpen()) this.hideSmoke();
    try { HelpModal.show(ctx); } catch (_) {}
  },

  hideHelp() {
    try { HelpModal.hide(); } catch (_) {}
  },

  isHelpOpen() {
    try { return !!HelpModal.isOpen(); } catch (_) { return false; }
  },

  // ---- Character Sheet (C) ----
  showCharacter(ctx = null) {
    // Close other modals for clarity
    if (this.isLootOpen()) this.hideLoot();
    if (this.isInventoryOpen()) this.hideInventory();
    if (this.isGodOpen()) this.hideGod();
    if (this.isSmokeOpen()) this.hideSmoke();
    try { CharacterModal.show(ctx); } catch (_) {}
  },

  hideCharacter() {
    try { CharacterModal.hide(); } catch (_) {}
  },

  isCharacterOpen() {
    try { return !!CharacterModal.isOpen(); } catch (_) { return false; }
  },

  // ---- Follower Inspect (bump follower) ----
  showFollower(ctx = null, view = null) {
    // Close other modals for clarity
    if (this.isLootOpen()) this.hideLoot();
    if (this.isInventoryOpen()) this.hideInventory();
    if (this.isGodOpen()) this.hideGod();
    if (this.isSmokeOpen()) this.hideSmoke();
    try { FollowerModal.show(ctx, view); } catch (_) {}
  },

  hideFollower() {
    try { FollowerModal.hide(); } catch (_) {}
  },

  isFollowerOpen() {
    try { return !!FollowerModal.isOpen(); } catch (_) { return false; }
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

  // Build or refresh the Smoke scenarios checkbox list
  renderSmokeOptions() {
    try {
      const container = this.els.smokeList || document.getElementById("smoke-scenarios");
      if (!container) return;

      // Capture existing selection (if re-rendering)
      const prev = new Set();
      try {
        const existing = Array.from(container.querySelectorAll("input.smoke-sel"));
        existing.forEach((inp) => {
          if (inp.checked && inp.value) prev.add(inp.value);
        });
      } catch (_) {}

      // Default list (fallback)
      let scenarios = [
        { id: "world", label: "World" },
        { id: "region", label: "Region Map" },
        { id: "inventory", label: "Inventory" },
        { id: "dungeon", label: "Dungeon" },
        { id: "combat", label: "Combat" },
        { id: "dungeon_persistence", label: "Dungeon Persistence" },
        { id: "town", label: "Town" },
        { id: "town_diagnostics", label: "Town Diagnostics" },
        { id: "overlays", label: "Overlays" },
        { id: "determinism", label: "Determinism" },
        { id: "encounters", label: "Encounters" },
        { id: "api", label: "API" },
        { id: "town_flows", label: "Town Flows" },
      ];

      // Try to load manifest if present
      const apply = (arr) => {
        // Render checkboxes
        const html = arr.map((s) => {
          const id = (s && s.id) ? s.id : "";
          if (!id) return "";
          const checked = prev.has(id) ? " checked" : "";
          const title = s.label || id;
          return `
            <label style="display:flex; align-items:center; gap:6px; padding:4px 6px; border:1px solid #253047; border-radius:6px; background:#0f1117;">
              <input type="checkbox" class="smoke-sel" value="${id}"${checked} />
              <span style="color:#cbd5e1; font-size:13px;">${title}</span>
            </label>
          `;
        }).join("");
        container.innerHTML = html;
      };

      try {
        fetch("/smoketest/scenarios.json", { cache: "no-cache" })
          .then((r) => r.ok ? r.json() : null)
          .then((j) => {
            const arr = (j && Array.isArray(j.scenarios)) ? j.scenarios : null;
            if (arr && arr.length) {
              apply(arr);
            } else {
              apply(scenarios);
            }
          })
          .catch(() => apply(scenarios));
      } catch (_) {
        apply(scenarios);
      }
    } catch (_) {}
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

  getMinimapFullState() {
    try {
      if (typeof window.MINIMAP_FULL === "boolean") return window.MINIMAP_FULL;
      const v = localStorage.getItem("MINIMAP_FULL");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    return false;
  },

  setMinimapFullState(enabled) {
    const on = !!enabled;
    try {
      window.MINIMAP_FULL = on;
      localStorage.setItem("MINIMAP_FULL", on ? "1" : "0");
    } catch (_) {}
    try {
      const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.requestDraw === "function") {
        UIO.requestDraw(null);
      } else if (typeof window !== "undefined" && window.GameLoop && typeof window.GameLoop.requestDraw === "function") {
        window.GameLoop.requestDraw();
      }
    } catch (_) {}
  },

  // --- HUD visibility toggles ---
  getOverworldHudState() {
    try {
      if (typeof window.SHOW_OVERWORLD_HUD === "boolean") return window.SHOW_OVERWORLD_HUD;
      const v = localStorage.getItem("SHOW_OVERWORLD_HUD");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    return true; // default ON
  },

  setOverworldHudState(enabled) {
    try {
      window.SHOW_OVERWORLD_HUD = !!enabled;
      localStorage.setItem("SHOW_OVERWORLD_HUD", enabled ? "1" : "0");
    } catch (_) {}
    this.updateOverworldHudButton();
    try {
      const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.requestDraw === "function") {
        UIO.requestDraw(null);
      } else if (typeof window !== "undefined" && window.GameLoop && typeof window.GameLoop.requestDraw === "function") {
        window.GameLoop.requestDraw();
      }
    } catch (_) {}
  },

  updateOverworldHudButton() {
    if (!this.els.godToggleOverworldHudBtn) return;
    const on = this.getOverworldHudState();
    this.els.godToggleOverworldHudBtn.textContent = `Overworld HUD: ${on ? "On" : "Off"}`;
    this.els.godToggleOverworldHudBtn.title = on ? "Hide biome/clock HUD" : "Show biome/clock HUD";
  },

  getRegionHudState() {
    try {
      if (typeof window.SHOW_REGION_HUD === "boolean") return window.SHOW_REGION_HUD;
      const v = localStorage.getItem("SHOW_REGION_HUD");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    return true;
  },

  setRegionHudState(enabled) {
    try {
      window.SHOW_REGION_HUD = !!enabled;
      localStorage.setItem("SHOW_REGION_HUD", enabled ? "1" : "0");
    } catch (_) {}
    this.updateRegionHudButton();
    try {
      const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.requestDraw === "function") {
        UIO.requestDraw(null);
      } else if (typeof window !== "undefined" && window.GameLoop && typeof window.GameLoop.requestDraw === "function") {
        window.GameLoop.requestDraw();
      }
    } catch (_) {}
  },

  updateRegionHudButton() {
    if (!this.els.godToggleRegionHudBtn) return;
    const on = this.getRegionHudState();
    this.els.godToggleRegionHudBtn.textContent = `Region HUD: ${on ? "On" : "Off"}`;
    this.els.godToggleRegionHudBtn.title = on ? "Hide Region Map HUD panel" : "Show Region Map HUD panel";
  },

  getEncounterHudState() {
    try {
      if (typeof window.SHOW_ENCOUNTER_HUD === "boolean") return window.SHOW_ENCOUNTER_HUD;
      const v = localStorage.getItem("SHOW_ENCOUNTER_HUD");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    return true;
  },

  setEncounterHudState(enabled) {
    try {
      window.SHOW_ENCOUNTER_HUD = !!enabled;
      localStorage.setItem("SHOW_ENCOUNTER_HUD", enabled ? "1" : "0");
    } catch (_) {}
    this.updateEncounterHudButton();
    try {
      const UIO = (typeof window !== "undefined" ? window.UIOrchestration : null);
      if (UIO && typeof UIO.requestDraw === "function") {
        UIO.requestDraw(null);
      } else if (typeof window !== "undefined" && window.GameLoop && typeof window.GameLoop.requestDraw === "function") {
        window.GameLoop.requestDraw();
      }
    } catch (_) {}
  },

  updateEncounterHudButton() {
    if (!this.els.godToggleEncounterHudBtn) return;
    const on = this.getEncounterHudState();
    this.els.godToggleEncounterHudBtn.textContent = `Encounter HUD: ${on ? "On" : "Off"}`;
    this.els.godToggleEncounterHudBtn.title = on ? "Hide Encounter HUD panel" : "Show Encounter HUD panel";
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

  // --- GOD invincibility toggle ---
  getInvincibleState() {
    try {
      if (typeof window.GOD_INVINCIBLE === "boolean") return window.GOD_INVINCIBLE;
      const v = localStorage.getItem("GOD_INVINCIBLE");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch (_) {}
    return false;
  },

  setInvincibleState(enabled) {
    try {
      window.GOD_INVINCIBLE = !!enabled;
      if (enabled) localStorage.setItem("GOD_INVINCIBLE", "1");
      else localStorage.removeItem("GOD_INVINCIBLE");
    } catch (_) {}
    if (this.els.godToggleInvincibleBtn) {
      this.els.godToggleInvincibleBtn.textContent = `Invincible: ${enabled ? "On" : "Off"}`;
    }
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
    if (this.isLootOpen()) this.hideLoot();
    try { GameOverModal.show(player, floor); } catch (_) {}
  },

  hideGameOver() {
    try { GameOverModal.hide(); } catch (_) {}
  }
};

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("UI", UI);