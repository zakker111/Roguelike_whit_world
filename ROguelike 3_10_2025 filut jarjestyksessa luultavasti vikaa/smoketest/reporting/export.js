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
      if (window.UI && typeof window.UI.showGod === "function") {
        window.UI.showGod();
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
      var btnHtml = '' +
        '<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">' +
        '  <button id="smoke-export-btn" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Report (JSON)</button>' +
        '  <button id="smoke-export-summary-btn" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Summary (TXT)</button>' +
        '  <button id="smoke-export-checklist-btn" style="padding:6px 10px; background:#1f2937; color:#e5e7eb; border:1px solid #334155; border-radius:4px; cursor:pointer;">Download Checklist (TXT)</button>' +
        '</div>';
      appendToPanel(btnHtml);
      ensureGodOpenAndScroll();

      setTimeout(function () {
        var jsonBtn = document.getElementById("smoke-export-btn");
        if (jsonBtn) {
          jsonBtn.onclick = function () {
            try {
              var blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
              var url = URL.createObjectURL(blob);
              var a = document.createElement("a");
              a.href = url;
              a.download = "smoketest_report.json";
              document.body.appendChild(a);
              a.click();
              setTimeout(function () {
                try { document.body.removeChild(a); } catch (_) {}
                try { URL.revokeObjectURL(url); } catch (_) {}
              }, 100);
            } catch (e) {
              try { console.error("Export failed", e); } catch (_) {}
            }
          };
        }
        var txtBtn = document.getElementById("smoke-export-summary-btn");
        if (txtBtn) {
          txtBtn.onclick = function () {
            try {
              var blob = new Blob([summaryText], { type: "text/plain" });
              var url = URL.createObjectURL(blob);
              var a = document.createElement("a");
              a.href = url;
              a.download = "smoketest_summary.txt";
              document.body.appendChild(a);
              a.click();
              setTimeout(function () {
                try { document.body.removeChild(a); } catch (_) {}
                try { URL.revokeObjectURL(url); } catch (_) {}
              }, 100);
            } catch (e) {
              try { console.error("Export summary failed", e); } catch (_) {}
            }
          };
        }
        var clBtn = document.getElementById("smoke-export-checklist-btn");
        if (clBtn) {
          clBtn.onclick = function () {
            try {
              var blob = new Blob([checklistText], { type: "text/plain" });
              var url = URL.createObjectURL(blob);
              var a = document.createElement("a");
              a.href = url;
              a.download = "smoketest_checklist.txt";
              document.body.appendChild(a);
              a.click();
              setTimeout(function () {
                try { document.body.removeChild(a); } catch (_) {}
                try { URL.revokeObjectURL(url); } catch (_) {}
              }, 100);
            } catch (e) {
              try { console.error("Export checklist failed", e); } catch (_) {}
            }
          };
        }
      }, 0);
    } catch (_) {}
  }

  window.SmokeTest.Reporting.Export = { attachButtons: attachButtons };
})();