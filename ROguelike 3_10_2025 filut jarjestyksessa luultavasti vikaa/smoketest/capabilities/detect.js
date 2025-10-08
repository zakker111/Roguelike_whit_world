/**
 * smoketest/capabilities/detect.js
 * Console/error capture and GameAPI capability detection.
 */
(function () {
  const NS = (window.SmokeTest = window.SmokeTest || {});

  const ConsoleCapture = {
    errors: [],
    warns: [],
    onerrors: [],
    installed: false,
    isNoise(msg) {
      try {
        const s = String(msg || "").toLowerCase();
        if (!s) return false;
        if (s.includes("klaviyo.com") || s.includes("static-tracking.klaviyo.com")) return true;
        if (s.includes("failed to load resource") && s.includes("err_blocked_by_client")) return true;
        if (s.includes("api.cosine.sh") || s.includes("wss://api.cosine.sh/editor")) return true;
        if (s.includes("err_internet_disconnected")) return true;
        if (s.includes("usecreatewebsocketcontext")) return true;
        if (s.includes("codeeditorwidget") && s.includes("cannot read properties of null")) return true;
        return false;
      } catch (_) {
        return false;
      }
    },
    install() {
      if (this.installed) return;
      this.installed = true;
      const self = this;
      try {
        const cerr = console.error.bind(console);
        const cwarn = console.warn.bind(console);
        console.error = function (...args) {
          try {
            const msg = args.map(String).join(" ");
            if (!self.isNoise(msg)) self.errors.push(msg);
          } catch (_) {}
          return cerr(...args);
        };
        console.warn = function (...args) {
          try {
            const msg = args.map(String).join(" ");
            if (!self.isNoise(msg)) self.warns.push(msg);
          } catch (_) {}
          return cwarn(...args);
        };
      } catch (_) {}
      try {
        window.addEventListener("error", (ev) => {
          try {
            const msg = ev && ev.message ? ev.message : String(ev);
            if (!self.isNoise(msg)) self.onerrors.push(msg);
          } catch (_) {}
        });
        window.addEventListener("unhandledrejection", (ev) => {
          try {
            const msg = ev && ev.reason ? (ev.reason.message || String(ev.reason)) : String(ev);
            const line = "unhandledrejection: " + msg;
            if (!self.isNoise(line)) self.onerrors.push(line);
          } catch (_) {}
        });
      } catch (_) {}
    },
    reset() {
      this.errors = [];
      this.warns = [];
      this.onerrors = [];
    },
    snapshot() {
      const filter = (arr) => arr.filter((m) => !this.isNoise(m));
      return {
        consoleErrors: filter(this.errors.slice(0)),
        consoleWarns: filter(this.warns.slice(0)),
        windowErrors: filter(this.onerrors.slice(0)),
      };
    },
  };

  function detectCaps() {
    const caps = {};
    try {
      caps.GameAPI = !!window.GameAPI;
      const api = window.GameAPI || {};
      caps.getMode = typeof api.getMode === "function";
      caps.getEnemies = typeof api.getEnemies === "function";
      caps.getTownProps = typeof api.getTownProps === "function";
      caps.getNPCs = typeof api.getNPCs === "function";
      caps.routeToDungeon = typeof api.routeToDungeon === "function";
      caps.gotoNearestDungeon = typeof api.gotoNearestDungeon === "function";
      caps.gotoNearestTown = typeof api.gotoNearestTown === "function";
      caps.getChestsDetailed = typeof api.getChestsDetailed === "function";
      caps.getDungeonExit = typeof api.getDungeonExit === "function";
      caps.checkHomeRoutes = typeof api.checkHomeRoutes === "function";
      caps.getShops = typeof api.getShops === "function";
      caps.isShopOpenNowFor = typeof api.isShopOpenNowFor === "function";
      caps.getShopSchedule = typeof api.getShopSchedule === "function";
      caps.advanceMinutes = typeof api.advanceMinutes === "function";
      caps.getClock = typeof api.getClock === "function";
      caps.equipItemAtIndexHand = typeof api.equipItemAtIndexHand === "function";
    } catch (_) {}
    return caps;
  }

  function devRandomAudit() {
    try {
      if (!(window.DEV || localStorage.getItem("DEV") === "1"))
        return { scanned: 0, hits: [] };
      const scripts = Array.from(document.scripts || []);
      const hits = [];
      for (const s of scripts) {
        const src = s.src || "";
        if (!src) continue;
        // Inline content check
        if (!src && s.text && s.text.includes("Math.random")) {
          hits.push({ type: "inline", snippet: (s.text || "").slice(0, 120) });
        }
      }
      try {
        const html = document.documentElement.outerHTML || "";
        if ((html.match(/Math\.random/g) || []).length > 0) {
          hits.push({
            type: "dom",
            note: "Math.random appears in page HTML (might be harmless).",
          });
        }
      } catch (_) {}
      return { scanned: scripts.length, hits };
    } catch (_) {
      return { scanned: 0, hits: [] };
    }
  }

  NS.ConsoleCapture = ConsoleCapture;
  NS.detectCaps = detectCaps;
  NS.devRandomAudit = devRandomAudit;

  // Install error capture immediately
  try {
    ConsoleCapture.install();
  } catch (_) {}
})();