/**
 * Logger: in-DOM log with capped length, optional right-side mirror, and batched flushes.
 *
 * Exports (ESM + window.Logger):
 * - Logger.init(target = "#log", max = 60): boolean
 * - Logger.log(message, type = "info", details?)    // structured payloads supported
 * - Logger.download(filename?)                      // export history to a file
 * - Logger.getHistory()                             // access in-memory history
 * - Logger.captureGlobalErrors(): attach window error handlers that log with line numbers
 * - Logger.logError(err, context?): logs an Error with best-effort file:line:col extraction
 * Types: info, notice, warn, error/bad, fatal/crit/death, block, good, flavor.
 *
 * Notes:
 * - If an element with id="log-right" exists and LOG_MIRROR !== false, entries are mirrored there.
 * - DOM writes are batched at ~12 Hz to reduce layout thrash during heavy turns (town mode).
 * - Cadence: flushEvery ≈ 80 ms (~12.5 Hz). Common types used across the codebase: info, notice, good, warn, bad, crit, block, death, flavor.
 */
import { LogConfig } from "../utils/logging_config.js";

export const Logger = {
  _el: null,
  _elRight: null,
  _max: 60,

  // batching
  _queue: [],
  _timer: null,
  _lastFlush: 0,
  _flushEveryMs: 80, // ~12.5 Hz
  _mirrorEnabledCached: true,

  // history for export (structured)
  _history: [],
  _historyMax: 2000,

  init(target, max) {
    if (typeof max === "number" && max > 0) {
      this._max = max;
    }
    if (!target) {
      this._el = document.getElementById("log");
    } else if (typeof target === "string") {
      this._el = document.querySelector(target);
    } else if (target instanceof HTMLElement) {
      this._el = target;
    }
    // discover optional right-side mirror (honor global toggle)
    try {
      if (window.LOG_MIRROR === false) {
        this._elRight = null;
      } else {
        this._elRight = document.getElementById("log-right") || null;
      }
    } catch (_) {
      this._elRight = null;
    }
    // cache mirror visibility to avoid per-log getComputedStyle calls
    try {
      if (this._elRight) {
        const cs = window.getComputedStyle(this._elRight);
        this._mirrorEnabledCached = !(cs && (cs.display === "none" || cs.visibility === "hidden"));
      } else {
        this._mirrorEnabledCached = false;
      }
    } catch (_) {
      this._mirrorEnabledCached = !!this._elRight;
    }
    return this._el != null;
  },

  _scheduleFlush() {
    if (this._timer) return;
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const dueIn = Math.max(0, this._flushEveryMs - (now - this._lastFlush));
    this._timer = setTimeout(() => {
      this._timer = null;
      this._flush();
    }, dueIn);
  },

  _flush() {
    const el = this._el || document.getElementById("log");
    if (!el || this._queue.length === 0) {
      this._lastFlush = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      return;
    }

    // Build fragments once
    const fragMain = document.createDocumentFragment();
    const fragRight = document.createDocumentFragment();
    // Insert newest first at the top: iterate queue in reverse to preserve prepend order
    for (let i = this._queue.length - 1; i >= 0; i--) {
      const { msg, type, details } = this._queue[i];
      const node = document.createElement("div");
      node.className = `entry ${type}`;
      node.textContent = String(msg);

      if (details && typeof details === "object") {
        // Add a small toggle to expand structured payload
        const toggle = document.createElement("span");
        toggle.className = "detail-toggle";
        toggle.textContent = " details";
        const pre = document.createElement("pre");
        pre.className = "details";
        try {
          pre.textContent = JSON.stringify(details, null, 2);
        } catch (_) {
          pre.textContent = String(details);
        }
        pre.style.display = "none";
        toggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          pre.style.display = (pre.style.display === "none") ? "block" : "none";
        });
        node.appendChild(toggle);
        node.appendChild(pre);
      }

      fragMain.appendChild(node);

      if (this._elRight && this._mirrorEnabledCached) {
        const node2 = document.createElement("div");
        node2.className = `entry ${type}`;
        node2.textContent = String(msg);
        fragRight.appendChild(node2);
      }
    }
    // Clear queue before DOM ops so reentrant logs don't mix
    this._queue.length = 0;

    // Prepend in a single operation
    el.prepend(fragMain);
    while (el.childNodes.length > this._max) {
      el.removeChild(el.lastChild);
    }

    if (this._elRight && this._mirrorEnabledCached) {
      this._elRight.prepend(fragRight);
      while (this._elRight.childNodes.length > this._max) {
        this._elRight.removeChild(this._elRight.lastChild);
      }
    }

    this._lastFlush = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  },

  log(msg, type = "info", details = null) {
    if (!this._el) this.init();
    if (!this._el) return;
    try {
      if (LogConfig && typeof LogConfig.canEmit === "function") {
        if (!LogConfig.canEmit(type, msg, details)) return;
      }
    } catch (_) {}
    this._queue.push({ msg, type, details });

    // Add to history for export
    try {
      const time = Date.now();
      const cat = (LogConfig && typeof LogConfig.extractCategory === "function")
        ? LogConfig.extractCategory(msg, details)
        : "General";
      const entry = { time, type, category: String(cat || "General").toLowerCase(), msg: String(msg) };
      if (details != null) entry.details = details;
      this._history.push(entry);
      if (this._history.length > this._historyMax) this._history.splice(0, this._history.length - this._historyMax);
    } catch (_) {}

    this._scheduleFlush();
  },

  getHistory() {
    return this._history.slice(0);
  },

  download(filename) {
    try {
      const name = String(filename || "game_logs.txt");
      const lines = this._history.map(e => {
        const t = new Date(e.time).toISOString();
        const lvl = e.type;
        const cat = e.category || "general";
        const base = `[${t}] [${lvl}] [${cat}] ${e.msg}`;
        if (e.details != null) {
          try { return base + " " + JSON.stringify(e.details); }
          catch (_) { return base + " " + String(e.details); }
        }
        return base;
      });
      const blob = new Blob([lines.join("\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 1500);
    } catch (e) {
      try { console.error(e); } catch (_) {}
    }
  },

  // Best-effort stack frame (file:line:col) extraction
  _extractFrame(errOrStack) {
    let stack = "";
    if (!errOrStack) return null;
    if (typeof errOrStack === "string") stack = errOrStack;
    else if (errOrStack && typeof errOrStack.stack === "string") stack = errOrStack.stack;
    else return null;

    // Try common Chrome/Firefox formats: "at func (file:line:col)" or "file:line:col"
    const lines = stack.split("\n");
    for (const ln of lines) {
      // parentheses form
      let m = ln.match(/\(([^)]+):(\d+):(\d+)\)/);
      if (m) return { file: m[1], line: Number(m[2]), col: Number(m[3]) };
      // bare form
      m = ln.match(/([^\s()]+):(\d+):(\d+)/);
      if (m) return { file: m[1], line: Number(m[2]), col: Number(m[3]) };
    }
    return null;
  },

  logError(err, context) {
    try {
      const name = (err && err.name) ? err.name : "Error";
      const msg = (err && err.message) ? err.message : String(err);
      const frame = this._extractFrame(err);
      const where = frame ? `${frame.file}:${frame.line}:${frame.col}` : (context || "");
      const text = where ? `${name}: ${msg} @ ${where}` : `${name}: ${msg}`;
      this.log(text, "bad", { context: where || "global" });
    } catch (_) {
      // fall back
      this.log(String(err), "bad");
    }
  },

  captureGlobalErrors() {
    // Synchronous errors
    try {
      window.addEventListener("error", (ev) => {
        const baseMsg = (ev && ev.message) ? ev.message : "Unhandled error";
        const file = (ev && ev.filename) || "";
        const line = (ev && typeof ev.lineno === "number") ? ev.lineno : null;
        const col = (ev && typeof ev.colno === "number") ? ev.colno : null;
        const where = (file || line != null || col != null)
          ? `${file}${line != null ? ":" + line : ""}${col != null ? ":" + col : ""}`
          : "";
        // Prefer error.stack when available
        const err = (ev && ev.error) ? ev.error : null;
        if (err) {
          this.logError(err, where);
        } else {
          const text = where ? `${baseMsg} @ ${where}` : baseMsg;
          this.log(text, "bad", { context: "window.onerror" });
        }
      });
    } catch (_) {}

    // Unhandled Promise rejections
    try {
      window.addEventListener("unhandledrejection", (ev) => {
        const reason = ev && ev.reason;
        if (reason && typeof reason === "object") {
          this.logError(reason, "unhandledrejection");
        } else {
          this.log(`Unhandled rejection: ${String(reason)}`, "bad", { context: "unhandledrejection" });
        }
      });
    } catch (_) {}
  }
};

// Auto-init on load, best-effort
try { Logger.init(); } catch (e) { /* ignore */ }
try { Logger.captureGlobalErrors(); } catch (_) {}

import { attachGlobal } from "../utils/global.js";
// Back-compat: attach to window via helper
attachGlobal("Logger", Logger);