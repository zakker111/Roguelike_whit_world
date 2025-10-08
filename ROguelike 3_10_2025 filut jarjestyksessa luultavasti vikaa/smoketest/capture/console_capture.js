// SmokeTest Console/Browser error capture
(function () {
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
      } catch (_) { return false; }
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
      const filter = (arr) => arr.filter(m => !this.isNoise(m));
      return {
        consoleErrors: filter(this.errors.slice(0)),
        consoleWarns: filter(this.warns.slice(0)),
        windowErrors: filter(this.onerrors.slice(0)),
      };
    }
  };
  ConsoleCapture.install();
  window.SmokeConsoleCapture = ConsoleCapture;
})();