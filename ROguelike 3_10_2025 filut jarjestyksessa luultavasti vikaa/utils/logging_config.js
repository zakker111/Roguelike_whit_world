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
    crit: "fatal",
    death: "fatal"
  },
  _cats: Object.create(null),
  _defaultCats: [
    "General","AI","Boot","Combat","Data","Dungeon","Enemies","Entities","Items",
    "Overlays","Palette","Quest","Region","Render","RNG","Services",
    "Shop","Smoketest","Town","UI","Validation","World"
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

  extractCategory(msg) {
    const m = String(msg || "").match(/^\s*\[([^\]]+)\]/);
    if (m && m[1]) return m[1];
    return "General";
  },

  canEmit(type, msg) {
    const lvl = this.typeToLevel(type);
    if (lvl < this.getThresholdValue()) return false;
    const cat = this.extractCategory(msg);
    this.registerCategory(cat);
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