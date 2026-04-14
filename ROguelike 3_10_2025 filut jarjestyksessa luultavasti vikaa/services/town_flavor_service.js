function currentTownRecord(ctx) {
  try {
    if (!ctx || !ctx.worldReturnPos || !Array.isArray(ctx.world?.towns)) return null;
    const wx = ctx.worldReturnPos.x | 0;
    const wy = ctx.worldReturnPos.y | 0;
    return ctx.world.towns.find(t => t && (t.x | 0) === wx && (t.y | 0) === wy) || null;
  } catch (_) {
    return null;
  }
}

function uniquePush(list, value) {
  const v = String(value || "").trim();
  if (!v) return;
  if (!list.includes(v)) list.push(v);
}

function hasNamedTownProp(ctx, re) {
  try {
    const props = Array.isArray(ctx?.townProps) ? ctx.townProps : [];
    return props.some(p => p && re.test(String(p.name || "")));
  } catch (_) {
    return false;
  }
}

function storyRumorFromQuestBoard(ctx) {
  try {
    const QS = (typeof window !== "undefined") ? window.QuestService : null;
    if (!QS || typeof QS.listForCurrentTown !== "function") return null;
    const board = QS.listForCurrentTown(ctx);
    const story = board && board.story && typeof board.story === "object" ? board.story : null;
    if (!story) return null;
    return {
      stage: String(story.stage || ""),
      tone: String(story.tone || ""),
      text: String(story.text || ""),
      cta: String(story.cta || "")
    };
  } catch (_) {
    return null;
  }
}

export function getTownDistricts(ctx) {
  const districts = [];
  const rec = currentTownRecord(ctx);
  const kind = String((rec && rec.kind) || ctx?.townKind || "town");
  const isHarborTown = !!((rec && rec.harborDir) || ctx?.townHarborDir) && kind !== "castle";

  if (ctx?.townExitAt) uniquePush(districts, "Gate Ward");
  if (ctx?.townPlaza || (Array.isArray(ctx?.shops) && ctx.shops.length)) uniquePush(districts, "Market Square");
  if (ctx?.tavern) uniquePush(districts, "Inn Commons");
  if (hasNamedTownProp(ctx, /temple|shrine|chapel/i)) uniquePush(districts, "Temple Quarter");
  if (kind === "castle") uniquePush(districts, "Keep Ward");
  if (isHarborTown) uniquePush(districts, "Harbor Front");
  uniquePush(districts, "Residential Lanes");

  return districts.slice(0, 4);
}

export function getTownRumors(ctx) {
  const rumors = [];
  const rec = currentTownRecord(ctx);
  const kind = String((rec && rec.kind) || ctx?.townKind || "town");
  const isHarborTown = !!((rec && rec.harborDir) || ctx?.townHarborDir) && kind !== "castle";
  const storyRumor = storyRumorFromQuestBoard(ctx);

  if (storyRumor && storyRumor.text) {
    rumors.push({
      source: "thread",
      stage: storyRumor.stage,
      tone: storyRumor.tone,
      text: storyRumor.text,
      cta: storyRumor.cta || ""
    });
  }

  if (isHarborTown) {
    rumors.push({
      source: "district",
      tone: "info",
      text: "Dockworkers shout over crates and wet rope while traders watch the waterfront for news.",
      cta: ""
    });
  } else if (kind === "castle") {
    rumors.push({
      source: "district",
      tone: "info",
      text: "The keep dominates the center of town, and the guards make it clear they are paying attention.",
      cta: ""
    });
  } else {
    rumors.push({
      source: "district",
      tone: "info",
      text: "Most of the town's gossip drifts through the market square before it reaches the gate.",
      cta: ""
    });
  }

  return rumors;
}

export function getTownStatusSummary(ctx) {
  const rec = currentTownRecord(ctx);
  const name = String(ctx?.townName || (rec && rec.name) || "Unknown Town");
  const kind = String((rec && rec.kind) || ctx?.townKind || "town");
  const isHarborTown = !!((rec && rec.harborDir) || ctx?.townHarborDir) && kind !== "castle";
  const title = kind === "castle"
    ? `Castle of ${name}`
    : (isHarborTown ? `Harbor town of ${name}` : `Town of ${name}`);
  const districts = getTownDistricts(ctx);
  const rumors = getTownRumors(ctx);
  return {
    name,
    kind,
    title,
    districts,
    rumors,
    primaryRumor: rumors.length ? rumors[0] : null
  };
}

if (typeof window !== "undefined") {
  window.TownFlavorService = {
    getTownDistricts,
    getTownRumors,
    getTownStatusSummary
  };
}
