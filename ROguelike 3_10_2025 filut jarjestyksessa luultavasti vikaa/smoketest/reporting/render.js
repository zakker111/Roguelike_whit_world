(function () {
  // SmokeTest Reporting: pure rendering helpers (no DOM writes)
  window.SmokeTest = window.SmokeTest || {};
  window.SmokeTest.Reporting = window.SmokeTest.Reporting || {};

  const Render = {
    // Pretty list of step results
    renderStepsPretty(list) {
      if (!Array.isArray(list)) return "";
      return list.map(s => {
        const isSkip = !!s.skipped;
        const isOk = !!s.ok && !isSkip;
        const isFail = !s.ok && !isSkip;

        // Detect "inconclusive" runs (e.g., death/immobile aborts)
        const msg = String(s.msg || "");
        const msgL = msg.toLowerCase();
        const isInconclusive = (!isOk && !isSkip) && (
          msgL.includes("death detected") ||
          msgL.includes("game over") ||
          msgL.includes("immobile")
        );

        // Style palette
        const bgOk = "rgba(34,197,94,0.10)";
        const brOk = "#86efac";
        const bgSkip = "rgba(234,179,8,0.10)";
        const brSkip = "#fde68a";
        const bgFail = "rgba(239,68,68,0.10)";
        const brFail = "#fca5a5";
        const bgInc = "rgba(148,163,184,0.12)";   // slate-400 tint
        const brInc = "#94a3b8";                  // slate-400

        const bg = isSkip ? bgSkip : (isOk ? bgOk : (isInconclusive ? bgInc : bgFail));
        const border = isSkip ? brSkip : (isOk ? brOk : (isInconclusive ? brInc : brFail));
        const color = border;

        const mark = isSkip ? "⏭" : (isOk ? "✔" : (isInconclusive ? "…" : "✖"));
        const badge = isSkip
          ? "<span style=\"font-size:10px;color:#1f2937;background:#fde68a;border:1px solid #f59e0b;padding:1px 4px;border-radius:4px;margin-left:6px;\">SKIP</span>"
          : (isOk
            ? "<span style=\"font-size:10px;color:#1f2937;background:#86efac;border:1px solid #22c55e;padding:1px 4px;border-radius:4px;margin-left:6px;\">OK</span>"
            : (isInconclusive
              ? "<span style=\"font-size:10px;color:#1f2937;background:#cbd5e1;border:1px solid #94a3b8;padding:1px 4px;border-radius:4px;margin-left:6px;\">INCONCLUSIVE</span>"
              : "<span style=\"font-size:10px;color:#1f2937;background:#fca5a5;border:1px solid #ef4444;padding:1px 4px;border-radius:4px;margin-left:6px;\">FAIL</span>"
            )
          );

        return "<div style=\"display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border:1px solid " + border + ";border-radius:6px;background:" + bg + ";margin:4px 0;\">"
               + "<div style=\"min-width:16px;color:" + color + ";font-weight:bold;\">" + mark + "</div>"
               + "<div style=\"color:" + color + "\">" + msg + badge + "</div>"
               + "</div>";
      }).join("");
    },

    // Helper to build key checklist from a set of steps
    buildKeyChecklistHtmlFromSteps(steps) {
      if (!Array.isArray(steps)) return "";
      function hasStep(sub, okOnly = true) {
        for (const s of steps) {
          if (okOnly && !s.ok) continue;
          if (String(s.msg || "").toLowerCase().includes(String(sub).toLowerCase())) return true;
        }
        return false;
      }
      const keyChecks = [
        { label: "Entered dungeon", pass: hasStep("Entered dungeon") },
        { label: "Looted chest", pass: hasStep("Looted chest at (") },
        { label: "Chest invariant persists (empty on re-enter)", pass: hasStep("Chest invariant:") },
        { label: "Spawned enemy from GOD", pass: hasStep("Dungeon spawn: enemies") },
        { label: "Enemy types present", pass: hasStep("Enemy types present:") },
        { label: "Enemy glyphs not '?'", pass: hasStep("Enemy glyphs:") && !hasStep('All enemy glyphs are "?"', false) },
        { label: "Attacked enemy (moved/attempted attacks)", pass: hasStep("Moved and attempted attacks") },
        { label: "Killed enemy (corpse increased)", pass: hasStep("Killed enemy: YES") },
        { label: "Decay increased on equipped hand(s)", pass: hasStep("Decay check:") && !hasStep("Decay did not increase", false) },
        { label: "Stair guard (G on non-stair doesn’t exit)", pass: hasStep("Stair guard: G on non-stair does not exit dungeon") },
        { label: "Returned to overworld from dungeon", pass: hasStep("Returned to overworld from dungeon") },
        { label: "Dungeon corpses persisted", pass: hasStep("Persistence corpses:") },
        { label: "Dungeon decals persisted", pass: hasStep("Persistence decals:") },
        { label: "Town entered", pass: hasStep("Entered town") },
        { label: "NPCs present in town", pass: hasStep("NPC presence: count") },
        { label: "Bumped into NPC", pass: hasStep("Bumped into at least one NPC") },
        { label: "NPC home has decorations/props", pass: hasStep("NPC home has") },
        { label: "Shop UI closes with Esc", pass: hasStep("Shop UI closes with Esc") },
      ];
      const rows = keyChecks.map(c => {
        const mark = c.pass ? "[x]" : "[ ]";
        const color = c.pass ? "#86efac" : "#fca5a5";
        return "<div style=\"color:" + color + ";\">" + mark + " " + c.label + "</div>";
      }).join("");
      return "<div style=\"margin-top:10px;\"><strong>Key Checklist</strong></div>" + rows;
    },

    // New: header renderer
    renderHeader(meta) {
      try {
        const ok = !!meta.ok;
        const stepCount = meta.stepCount | 0;
        const totalIssues = meta.totalIssues | 0;
        const rv = String(meta.runnerVersion || "");
        const caps = Array.isArray(meta.caps) ? meta.caps : [];
        const capsLine = caps.length
          ? `<div class="help" style="color:#8aa0bf; margin-top:6px;">Runner v${rv} | Caps: ${caps.join(", ")}</div>`
          : `<div class="help" style="color:#8aa0bf; margin-top:6px;">Runner v${rv}</div>`;
        return [
          `<div style="margin-bottom:6px;">`,
          `<div><strong>Smoke Test Result:</strong> ${ok ? "<span style='color:#86efac'>PASS</span>" : "<span style='color:#fca5a5'>PARTIAL/FAIL</span>"}</div>`,
          `<div>Steps: ${stepCount}  Issues: <span style="color:${totalIssues ? "#ef4444" : "#86efac"};">${totalIssues}</span></div>`,
          capsLine,
          `</div>`
        ].join("");
      } catch (_) { return ""; }
    },

    // New: main report renderer (assembled sections)
    renderMainReport(parts) {
      try {
        const headerHtml = String(parts.headerHtml || "");
        const keyChecklistHtml = String(parts.keyChecklistHtml || "");
        const issuesHtml = String(parts.issuesHtml || "");
        const passedHtml = String(parts.passedHtml || "");
        const skippedHtml = String(parts.skippedHtml || "");
        const detailsTitle = String(parts.detailsTitle || `<div style="margin-top:10px;"><strong>Step Details</strong></div>`);
        const detailsHtml = String(parts.detailsHtml || "");

        return [
          headerHtml,
          keyChecklistHtml,
          issuesHtml,
          passedHtml,
          skippedHtml,
          detailsTitle,
          detailsHtml
        ].join("");
      } catch (_) { return ""; }
    }
  };

  window.SmokeTest.Reporting.Render = Render;
})();