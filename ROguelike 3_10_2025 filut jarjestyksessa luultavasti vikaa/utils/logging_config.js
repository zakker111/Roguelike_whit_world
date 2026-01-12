/**
 * LogConfig: runtime log filtering (levels + categories), persisted via localStorage.
 * Minimal overhead; integrates with existing window.Logger.log().
 *
 * API (ESM + window.LogConfig):
 * - init()
 * - setThreshold(name)            // name: "info"|"notice"|"warn"|"error"|"fatal"
 * - getThresholdName()
 * - isCategoryEnabled(cat)
 * - setCategory(cat, enabled)
 * - getCategories()               // [{ id, enabled }]
 * - canEmit(type, msg)            // gate for Logger
 * - reset()
 */
export const LogConfig = {
  _thresholdName: "info",
  _levels: { all: 0, info: 10, notice: 15, warn: 20, error: 30, fatal: 40 },
  _typeMap: {
    info: "info",
    good: "info",
    flavor: "info",
    block: "info",
    notice: "notice",
    warn: "warn",
    error: "error",
    bad: "error",
    fatal: "fatal",
    // Treat combat crits as visible at info threshold; fatal remains fatal.
    crit: "info",
    death: "fatal"
  },
  _cats: Object.create(null),
  _defaultCats: [
    "General","AI","Boot","Combat","Data","Dungeon","DungeonState","Enemies","Entities","Encounter","Items",
    "Overlays","Palette","Prefabs","Quest","Region","Render","RNG","Services","Shop","Smoketest",
    "Town","TownState","TownGen","World","WorldGen","Occupancy","Movement"
  ],

  init() {
    try {
      const raw = localStorage.getItem("LOG_LEVEL");
      if (raw) this._thresholdName = String(raw).toLowerCase();
    } catch (_) {}
    try {
      const raw = localStorage.getItem("LOG_CATEGORIES");
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") this._cats = obj;
      }
    } catch (_) {}
    this._defaultCats.forEach((c) => {
      const k = this.normalizeCategory(c);
      if (typeof this._cats[k] !== "boolean") this._cats[k] = true;
    });
  },

  getThresholdName() {
    return this._thresholdName;
  },

  getThresholdValue() {
    return this._levels[this._thresholdName] || this._levels.info;
  },

  setThreshold(name) {
    if (!name) return;
    const n = String(name).toLowerCase();
    if (this._levels[n] != null) {
      this._thresholdName = n;
      try { localStorage.setItem("LOG_LEVEL", n); } catch (_) {}
    }
  },

  normalizeCategory(c) {
    let s = String(c || "").trim();
    s = s.replace(/^[\[\s]+|[\]\s]+$/g, "");
    return s.toLowerCase();
  },

  displayName(cat) {
    const n = this.normalizeCategory(cat);
    return n ? (n.charAt(0).toUpperCase() + n.slice(1)) : "General";
  },

  isCategoryEnabled(cat) {
    const k = this.normalizeCategory(cat || "General");
    const v = this._cats[k];
    return (typeof v === "boolean") ? v : true;
  },

  setCategory(cat, enabled) {
    const k = this.normalizeCategory(cat || "General");
    this._cats[k] = !!enabled;
    try { localStorage.setItem("LOG_CATEGORIES", JSON.stringify(this._cats)); } catch (_) {}
  },

  registerCategory(cat) {
    const k = this.normalizeCategory(cat || "General");
    if (typeof this._cats[k] !== "boolean") {
      this._cats[k] = true;
      try { localStorage.setItem("LOG_CATEGORIES", JSON.stringify(this._cats)); } catch (_) {}
    }
  },

  getCategories() {
    const out = [];
    try {
      for (const k in this._cats) {
        if (Object.prototype.hasOwnProperty.call(this._cats, k)) {
          out.push({ id: k, enabled: !!this._cats[k] });
        }
      }
    } catch (_) {}
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
  },

  typeToLevel(type) {
    const t = String(type || "info").toLowerCase();
    const key = this._typeMap[t] || "info";
    return this._levels[key] || this._levels.info;
  },

  extractCategory(msg, opts) {
    // 1) Explicit category via options
    try {
      const c = opts && (opts.category || (opts.cat));
      if (c) return c;
    } catch (_) {}

    // 2) Bracketed prefix [Category]
    const m = String(msg || "").match(/^\s*\[([^\]]+)\]/);
    if (m && m[1]) return m[1];

    // 3) Heuristics based on common message prefixes and keywords
    try {
      const s = String(msg || "").toLowerCase();

      // Strong prefixes
      if (s.startsWith("strict prefabs") || s.includes("prefab")) return "Prefabs";
      if (s.startsWith("residential fill")) return "TownGen";
      if (s.startsWith("townstate.")) return "TownState";
      if (s.includes("you re-enter the town") || s.includes("you re-enter")) return "Town";
      if (s.includes("you return to the overworld") || s.includes("you arrive in the overworld") || s.includes("overworld")) return "World";
      if (s.includes("dungeonstate") || s.includes("you explore the dungeon") || s.includes("dungeon")) return "Dungeon";
      if (s.includes("region map")) return "Region";
      if (s.includes("encounter")) return "Encounter";
      if (s.includes("palette")) return "Palette";
      if (s.includes("render")) return "Render";
      if (s.includes("shop") || s.includes("sold out") || s.includes("you bought") || s.includes("you sold")) return "Shop";
      if (s.includes("npc") || s.includes("villager") || s.includes("talk")) return "Town";
      if (s.includes("ai ")) return "AI";
      if (s.includes("combat") || s.includes("blocks your attack") || s.includes("critical!")) return "Combat";
      if (s.includes("items") || s.includes("inventory") || s.includes("equip") || s.includes("potion")) return "Items";
      if (s.includes("smoke")) return "Smoketest";
      if (s.includes("rng")) return "RNG";
      if (s.includes("service")) return "Services";

      // Buff-related messages: treat as Buff category so they can share golden styling.
      if (s.includes("seen life") || s.startsWith("buff:") || s.includes(" buff ")) return "Buff";
    } catch (_) {}

    // 4) Default
    return "General";
  },

  canEmit(type, msg, opts) {
    const t = String(type || "info").toLowerCase();
    const mapped = this._typeMap[t] || "info";
    const lvl = this._levels[mapped] || this._levels.info;

    // Determine category first so we can special-case health diagnostics.
    const cat = this.extractCategory(msg, opts);
    this.registerCategory(cat);
    const catNorm = this.normalizeCategory(cat || "General");

    // Health diagnostics should always be visible regardless of level threshold.
    // This keeps startup health reports useful even when LOG_LEVEL is "info".
    if (catNorm === "health") {
      return this.isCategoryEnabled(cat);
    }

    // Special-case: threshold "info" should show ONLY info-level messages (and synonyms:
    //   info, good, flavor, block, crit)
    // This keeps default deploy quiet and player-facing.
    const thrName = this._thresholdName || "info";
    if (thrName === "info") {
      if (mapped !== "info") return false;
    } else {
      if (lvl < this.getThresholdValue()) return false;
    }

    return this.isCategoryEnabled(cat);
  },

  reset() {
    this._thresholdName = "info";
    this._cats = Object.create(null);
    this._defaultCats.forEach((c) => {
      this._cats[this.normalizeCategory(c)] = true;
    });
    try {
      localStorage.removeItem("LOG_LEVEL");
      localStorage.removeItem("LOG_CATEGORIES");
    } catch (_) {}
  }
};

try { LogConfig.init(); } catch (_) {}

import { attachGlobal } from "./global.js";
attachGlobal("LogConfig", LogConfig);