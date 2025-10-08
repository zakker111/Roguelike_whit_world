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

        const bg = isSkip ? "rgba(234,179,8,0.10)" : (isOk ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)");
        const border = isSkip ? "#fde68a" : (isOk ? "#86efac" : "#fca5a5");
        const color = border;
        const mark = isSkip ? "⏭" : (isOk ? "✔" : "✖");
        const badge = isSkip
          ? "<span style=\"font-size:10px;color:#1f2937;background:#fde68a;border:1px solid #f59e0b;padding:1px 4px;border-radius:4px;margin-left:6px;\">SKIP</span>"
          : (isOk
            ? "<span style=\"font-size:10px;color:#1f2937;background:#86efac;border:1px solid #22c55e;padding:1px 4px;border-radius:4px;margin-left:6px;\">OK</span>"
            : "<span style=\"font-size:10px;color:#1f2937;background:#fca5a5;border:1px solid #ef4444;padding:1px 4px;border-radius:4px;margin-left:6px;\">FAIL</span>");

        return "<div style=\"display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border:1px solid " + border + ";border-radius:6px;background:" + bg + ";margin:4px 0;\">" +
               "<div style=\"min-width:16px;color:" + color + ";font-weight:bold;\">" + mark + "</div>" +
               "<div style=\"color:" + color + "\">" + (s.msg || "") + badge + "</div>" +
               "</div>";
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
    }
  };

  window.SmokeTest.Reporting.Render = Render;
})();