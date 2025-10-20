/**
 * Logger: in-DOM log with capped length and optional right-side mirror.
 *
 * Exports (ESM + window.Logger):
 * - Logger.init(target = "#log", max = 60): boolean
 * - Logger.log(message, type = "info")
 * - Logger.captureGlobalErrors(): attach window error handlers that log with line numbers
 * - Logger.logError(err, context?): logs an Error with best-effort file:line:col extraction
 * Types: info, crit, block, death, good, warn, flavor.
 *
 * Notes:
 * - If an element with id="log-right" exists and LOG_MIRROR !== false, entries are mirrored there.
 */

export const Logger = {
  _el: null,
  _elRight: null,
  _max: 60,

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
    return this._el != null;
  },

  log(msg, type = "info") {
    if (!this._el) this.init();
    const el = this._el;
    if (!el) return;

    // main log
    const div = document.createElement("div");
    div.className = `entry ${type}`;
    div.textContent = String(msg);
    el.prepend(div);
    while (el.childNodes.length > this._max) {
      el.removeChild(el.lastChild);
    }

    // optional right mirror (skip if hidden by CSS or toggle)
    if (this._elRight) {
      let visible = true;
      try {
        const cs = window.getComputedStyle(this._elRight);
        if (cs && cs.display === "none" || cs && cs.visibility === "hidden") visible = false;
      } catch (_) {}
      if (visible) {
        const div2 = document.createElement("div");
        div2.className = `entry ${type}`;
        div2.textContent = String(msg);
        this._elRight.prepend(div2);
        while (this._elRight.childNodes.length > this._max) {
          this._elRight.removeChild(this._elRight.lastChild);
        }
      }
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
      this.log(text, "bad");
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
          this.log(text, "bad");
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
          this.log(`Unhandled rejection: ${String(reason)}`, "bad");
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