(function () {
  // SmokeTest Reporting: export buttons and downloads
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Reporting = window.SmokeTest.Reporting || {};

  function appendToPanel(html) {
    try {
      var H = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Logging;
      if (H && typeof H.appendToPanel === "function") return H.appendToPanel(html);
    } catch (_) {}
    try {
      var el = document.getElementById("god-check-output");
      if (el) el.innerHTML += html;
    } catch (_) {}
  }

  function ensureGodOpenAndScroll() {
    try {
      if (window.UIBridge && typeof window.UIBridge.showGod === "function") {
        window.UIBridge.showGod({});
      } else {
        try { var btn = document.getElementById("god-open-btn"); btn && btn.click(); } catch (_) {}
      }
      setTimeout(function () {
        try {
          var pre = document.getElementById("smoke-full-report");
          if (pre && typeof pre.scrollIntoView === "function") {
            pre.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        } catch (_) {}
      }, 50);
    } catch (_) {}
  }

  function attachButtons(report, summaryText, checklistText) {
    try {
      // Keep a handle for debugging / manual retrieval.
      try {
        window.SmokeTest = window.SmokeTest || {};
        window.SmokeTest.Reporting = window.SmokeTest.Reporting || {};
        window.SmokeTest.Reporting.lastReport = report;
      } catch (_) {}

      // If attachButtons is called multiple times, old buttons with the same IDs can remain in the DOM.
      // Avoid duplicate IDs by rendering into a single stable container.
      var container = document.getElementById("smoke-export-buttons");
      if (!container) {
        appendToPanel('<div id="smoke-export-buttons"></div>');
        container = document.getElementById("smoke-export-buttons");
      }
      if (!container) return;

      container.innerHTML = '' +
        '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '  <button data-smoke-export="json" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Report (JSON)</button>' +
        '  <button data-smoke-export="json-copy" style="padding:6px 10px; background:#111827; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Copy JSON</button>' +
        '  <button data-smoke-export="summary" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Summary (TXT)</button>' +
        '  <button data-smoke-export="checklist" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Checklist (TXT)</button>' +
        '</div>' +
        '<div style="margin-top:6px; opacity:0.85; font-size:12px; color:#8aa0bf;">If downloads are blocked, you can also copy from <code>localStorage["smoke-json-token"]</code>.</div>';

      ensureGodOpenAndScroll();

      function downloadText(filename, text, mime) {
        try {
          var blob = new Blob([text], { type: mime || "text/plain" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            try { document.body.removeChild(a); } catch (_) {}
            try { URL.revokeObjectURL(url); } catch (_) {}
          }, 100);
          return true;
        } catch (_) {
          return false;
        }
      }

      async function copyText(text) {
        try {
          if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(text);
            return true;
          }
        } catch (_) {}
        try { window.prompt("Copy JSON:", text); } catch (_) {}
        return true;
      }

      var btnJson = container.querySelector('[data-smoke-export="json"]');
      if (btnJson) {
        btnJson.onclick = function () {
          try {
            var text = JSON.stringify(report, null, 2);
            var ok = downloadText("smoketest_report.json", text, "application/json");
            if (!ok) {
              try { console.error("Export failed (download blocked)"); } catch (_) {}
              copyText(text);
            }
          } catch (e) {
            try { console.error("Export failed", e); } catch (_) {}
          }
        };
      }

      var btnJsonCopy = container.querySelector('[data-smoke-export="json-copy"]');
      if (btnJsonCopy) {
        btnJsonCopy.onclick = function () {
          try {
            var text = JSON.stringify(report, null, 2);
            copyText(text);
          } catch (e) {
            try { console.error("Copy JSON failed", e); } catch (_) {}
          }
        };
      }

      var btnSummary = container.querySelector('[data-smoke-export="summary"]');
      if (btnSummary) {
        btnSummary.onclick = function () {
          try {
            var ok = downloadText("smoketest_summary.txt", String(summaryText || ""), "text/plain");
            if (!ok) {
              try { console.error("Export summary failed (download blocked)"); } catch (_) {}
              copyText(String(summaryText || ""));
            }
          } catch (e) {
            try { console.error("Export summary failed", e); } catch (_) {}
          }
        };
      }

      var btnChecklist = container.querySelector('[data-smoke-export="checklist"]');
      if (btnChecklist) {
        btnChecklist.onclick = function () {
          try {
            var ok = downloadText("smoketest_checklist.txt", String(checklistText || ""), "text/plain");
            if (!ok) {
              try { console.error("Export checklist failed (download blocked)"); } catch (_) {}
              copyText(String(checklistText || ""));
            }
          } catch (e) {
            try { console.error("Export checklist failed", e); } catch (_) {}
          }
        };
      }
    } catch (_) {}
  }

  window.SmokeTest.Reporting.Export = { attachButtons: attachButtons };
})();