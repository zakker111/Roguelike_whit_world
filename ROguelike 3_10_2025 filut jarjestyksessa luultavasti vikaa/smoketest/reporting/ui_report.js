// Reporting helpers for smoketest
// Exposes window.SmokeReport with helpers to render summaries into GOD panel.

(function () {
  if (window.SmokeReport) return;

  function buildKeyChecklistHtmlFromSteps(steps) {
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
      return `<div style="color:${color};">${mark} ${c.label}</div>`;
    }).join("");
    return `<div style="margin-top:4px;"><em>Key Checklist</em></div>${rows}`;
  }

  window.SmokeReport = {
    buildKeyChecklistHtmlFromSteps
  };
})();