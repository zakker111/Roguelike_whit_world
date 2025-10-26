/**
 * Prefab Editor: standalone DEV tool to author houses/shops/inns compatible with data/worldgen/prefabs.json.
 * - Reads jcdocs tiles/embeddedPropCodes to build palettes.
 * - Paints a grid with tiles and embedded props, places doors, sets constraints and metadata.
 * - Supports optional upstairs overlay grid for inns.
 * - Exports a single prefab JSON object via clipboard or download.
 */

const state = {
  category: "house",
  w: 7, h: 6,
  tiles: [], // 2D array of strings (tile or embedded prop codes)
  doors: [], // [{x,y,orientation,type,role}]
  // brush
  brush: "tile", // tile|prop|door|erase
  tileSel: "FLOOR",
  propSel: "BED",
  // metadata
  id: "house_small_custom_1",
  name: "Custom Small House",
  tags: ["residential","single_story"],
  constraints: { rotations: [0,90,180,270], mirror: true, mustFaceRoad: true, minSetback: 1 },
  // shop
  shop: { type: "blacksmith", schedule: { open: "08:00", close: "17:00", alwaysOpen: false }, signText: "Blacksmith" },
  // upstairs
  upstairsEnabled: false,
  up: { offset: {x:1,y:1}, w:9, h:7, tiles: [] },
  // palettes
  jcdocs: { tiles: [], embeddedPropCodes: [] },
  // assets lookup (glyphs/colors) loaded from data/world/world_assets.json
  assets: { tiles: Object.create(null), props: Object.create(null) },
  lastDoorPaintPos: null,
};

const els = {};
const CELL = 24; // px cell size
const GRID_BG = "#0b0c10";
const GRID_LINE = "rgba(255,255,255,0.06)";

function init() {
  bindEls();
  initGrid();
  initUpGrid();
  // Load palettes and glyph/color assets
  Promise.all([loadJCDocs(), loadAssets()]).then(() => {
    renderPalettes();
    drawGrid();
    drawUpGrid();
    updateModeVisibility();
    lint();
  }).catch(() => {
    renderPalettes();
    drawGrid();
    drawUpGrid();
    updateModeVisibility();
    lint();
  });
  bindUI();
}

function bindEls() {
  els.backBtn = document.getElementById("back-btn");
  els.status = document.getElementById("status");
  els.category = document.getElementById("category");
  els.gridW = document.getElementById("grid-w");
  els.gridH = document.getElementById("grid-h");
  els.resizeBtn = document.getElementById("resize-btn");
  els.brush = document.getElementById("brush");
  els.tilePalette = document.getElementById("tile-palette");
  els.propPalette = document.getElementById("prop-palette");
  els.eraseBtn = document.getElementById("erase-brush-btn");
  els.grid = document.getElementById("grid");

  // Floating hover hint
  els.hint = document.createElement("div");
  els.hint.style.position = "fixed";
  els.hint.style.display = "none";
  els.hint.style.zIndex = "50010";
  els.hint.style.pointerEvents = "none";
  els.hint.style.background = "rgba(20,24,33,0.98)";
  els.hint.style.border = "1px solid rgba(80,90,120,0.6)";
  els.hint.style.borderRadius = "6px";
  els.hint.style.padding = "4px 6px";
  els.hint.style.color = "#cbd5e1";
  els.hint.style.fontSize = "12px";
  document.body.appendChild(els.hint);

  els.prefabId = document.getElementById("prefab-id");
  els.prefabName = document.getElementById("prefab-name");
  els.prefabTags = document.getElementById("prefab-tags");
  els.doorOrient = document.getElementById("door-orient");
  els.doorType = document.getElementById("door-type");
  els.doorRole = document.getElementById("door-role");
  els.doorApplyBtn = document.getElementById("door-apply-btn");
  els.doorsList = document.getElementById("doors-list");

  els.rotChecks = Array.from(document.querySelectorAll("input.rot"));
  els.mirror = document.getElementById("mirror");
  els.mustFaceRoad = document.getElementById("must-face-road");
  els.minSetback = document.getElementById("min-setback");

  els.shopFields = document.getElementById("shop-fields");
  els.shopType = document.getElementById("shop-type");
  els.shopOpen = document.getElementById("shop-open");
  els.shopClose = document.getElementById("shop-close");
  els.shopAlways = document.getElementById("shop-always");
  els.shopSign = document.getElementById("shop-sign");

  els.innFields = document.getElementById("inn-fields");
  els.upEnabled = document.getElementById("upstairs-enabled");
  els.upX = document.getElementById("up-x");
  els.upY = document.getElementById("up-y");
  els.upW = document.getElementById("up-w");
  els.upH = document.getElementById("up-h");
  els.upResizeBtn = document.getElementById("up-resize-btn");
  els.upGrid = document.getElementById("up-grid");

  els.copyJSONBtn = document.getElementById("copy-json-btn");
  els.downloadJSONBtn = document.getElementById("download-json-btn");

  els.lint = document.getElementById("lint");
}

function initGrid() {
  state.tiles = Array.from({length: state.h}, () => Array.from({length: state.w}, () => "FLOOR"));
  state.doors = [];
  if (els.grid) {
    // Fit canvas to grid size
    els.grid.width = Math.max(400, state.w * CELL + 2);
    els.grid.height = Math.max(300, state.h * CELL + 2);
  }
}

function initUpGrid() {
  state.up.tiles = Array.from({length: state.up.h}, () => Array.from({length: state.up.w}, () => "FLOOR"));
  if (els.upGrid) {
    els.upGrid.width = Math.max(240, state.up.w * CELL + 2);
    els.upGrid.height = Math.max(180, state.up.h * CELL + 2);
  }
}

async function loadJCDocs() {
  try {
    const res = await fetch("/data/worldgen/prefabs.json");
    const json = await res.json();
    const jd = (json && json.jcdocs) ? json.jcdocs : {};
    state.jcdocs.tiles = Array.isArray(jd.tiles) ? jd.tiles.map(String) : ["WALL","FLOOR","DOOR","WINDOW","STAIRS"];
    state.jcdocs.embeddedPropCodes = Array.isArray(jd.embeddedPropCodes) ? jd.embeddedPropCodes.map(String) : ["BED","TABLE","CHAIR"];
  } catch (e) {
    // Fallback palette
    state.jcdocs.tiles = ["WALL","FLOOR","DOOR","WINDOW","STAIRS"];
    state.jcdocs.embeddedPropCodes = ["BED","TABLE","CHAIR","SHELF","COUNTER","FIREPLACE","CHEST","CRATE","BARREL","PLANT","RUG","QUEST_BOARD","STALL","LAMP","WELL"];
  }
}

function renderPalettes() {
  // Helper to get glyph/color for a code
  const getGlyphInfo = (isTile, code) => {
    const key = String(code || "").toUpperCase();
    const def = isTile ? state.assets.tiles[key] : state.assets.props[key];
    const glyph = def && def.glyph ? String(def.glyph) : "";
    const fg = (def && def.colors && def.colors.fg) ? def.colors.fg : "#cbd5e1";
    return { key, glyph, fg };
  };

  // Tiles
  els.tilePalette.innerHTML = "";
  state.jcdocs.tiles.forEach(code => {
    const { key, glyph, fg } = getGlyphInfo(true, code);
    const btn = document.createElement("button");
    btn.className = "chip" + (state.tileSel === code ? " active" : "");
    // Show glyph prominently; fallback to key
    btn.textContent = glyph && glyph.trim().length ? glyph : key;
    btn.style.color = fg;
    btn.title = key;
    btn.addEventListener("click", () => {
      // auto-switch brush to tile to avoid confusion
      state.brush = "tile";
      if (els.brush) els.brush.value = "tile";
      state.tileSel = code;
      Array.from(els.tilePalette.children).forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
    });
    els.tilePalette.appendChild(btn);
  });

  // Props
  els.propPalette.innerHTML = "";
  state.jcdocs.embeddedPropCodes.forEach(code => {
    const { key, glyph, fg } = getGlyphInfo(false, code);
    const btn = document.createElement("button");
    btn.className = "chip" + (state.propSel === code ? " active" : "");
    btn.textContent = glyph && glyph.trim().length ? glyph : key;
    btn.style.color = fg;
    btn.title = key;
    btn.addEventListener("click", () => {
      // auto-switch brush to prop so painting works immediately
      state.brush = "prop";
      if (els.brush) els.brush.value = "prop";
      state.propSel = code;
      Array.from(els.propPalette.children).forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
    });
    els.propPalette.appendChild(btn);
  });
}

// Load glyph/color assets from world assets JSON for both tiles and props
async function loadAssets() {
  try {
    const res = await fetch("/data/world/world_assets.json");
    const json = await res.json();
    // Tiles
    const tilesArr = (json && json.tiles && Array.isArray(json.tiles.tiles)) ? json.tiles.tiles : [];
    const tmap = Object.create(null);
    tilesArr.forEach(t => {
      const key = String(t.key || "").toUpperCase();
      if (key) tmap[key] = t;
    });
    // Props
    const propsArr = (json && json.props && Array.isArray(json.props.props)) ? json.props.props : [];
    const pmap = Object.create(null);
    propsArr.forEach(p => {
      const key = String(p.key || "").toUpperCase();
      if (key) pmap[key] = p;
    });
    state.assets.tiles = tmap;
    state.assets.props = pmap;
  } catch (e) {
    // Fallback: minimal hardcoded glyphs to avoid empty display
    state.assets.tiles = {
      WALL: { glyph: "", colors: { fill: "#334155", fg: "#cbd5e1" } },
      FLOOR: { glyph: "", colors: { fill: "#0f172a", fg: "#cbd5e1" } },
      DOOR: { glyph: "+", colors: { fill: "#3a2f1b", fg: "#d7ba7d" } },
      WINDOW: { glyph: "\"", colors: { fill: "#295b6e", fg: "#89ddff" } },
      STAIRS: { glyph: ">", colors: { fill: "#1b1f2a", fg: "#d7ba7d" } },
    };
    state.assets.props = {
      BED: { glyph: "‗", colors: { fg: "#cbd5e1" } },
      TABLE: { glyph: "⊔", colors: { fg: "#cbd5e1" } },
      CHAIR: { glyph: "⟂", colors: { fg: "#cbd5e1" } },
      SHELF: { glyph: "≡", colors: { fg: "#cbd5e1" } },
      COUNTER: { glyph: "▭", colors: { fg: "#d7ba7d" } },
      FIREPLACE: { glyph: "♨", colors: { fg: "#ff6d00" } },
      CHEST: { glyph: "□", colors: { fg: "#d7ba7d" } },
      CRATE: { glyph: "▢", colors: { fg: "#b59b6a" } },
      BARREL: { glyph: "◍", colors: { fg: "#a07c4b" } },
      PLANT: { glyph: "*", colors: { fg: "#84cc16" } },
      RUG: { glyph: "░", colors: { fg: "#b59b6a" } },
      QUEST_BOARD: { glyph: "▤", colors: { fg: "#cbd5e1" } },
      STALL: { glyph: "▣", colors: { fg: "#d7ba7d" } },
      LAMP: { glyph: "†", colors: { fg: "#ffd166" } },
      WELL: { glyph: "◍", colors: { fg: "#7aa2f7" } },
    };
  }
}

function bindUI() {
  els.backBtn.addEventListener("click", () => {
    try { window.location.assign("/index.html"); } catch (_) { window.location.href = "/"; }
  });
  els.category.addEventListener("change", () => {
    state.category = els.category.value;
    // Suggest metadata defaults
    if (state.category === "house") {
      state.id = "house_small_custom_1"; state.name = "Custom Small House";
      state.tags = ["residential","single_story"];
    } else if (state.category === "shop") {
      state.id = "shop_blacksmith_custom_1"; state.name = "Blacksmith (Custom)";
      state.tags = ["shop","blacksmith"];
      state.shop = { type:"blacksmith", schedule:{open:"08:00", close:"17:00", alwaysOpen:false}, signText:"Blacksmith" };
    } else {
      state.id = "inn_tavern_custom"; state.name = "Inn & Tavern (Custom)";
      state.tags = ["two_story","tavern"];
    }
    syncMetadataFields();
    updateModeVisibility();
    lint();
  });
  els.gridW.addEventListener("input", () => {});
  els.gridH.addEventListener("input", () => {});
  els.resizeBtn.addEventListener("click", () => {
    const w = clampInt(els.gridW.value, 3, 32);
    const h = clampInt(els.gridH.value, 3, 32);
    state.w = w; state.h = h;
    initGrid();
    drawGrid();
    lint();
  });
  els.brush.addEventListener("change", () => {
    state.brush = els.brush.value;
  });
  if (els.eraseBtn) {
    els.eraseBtn.addEventListener("click", () => {
      state.brush = "erase";
      if (els.brush) els.brush.value = "erase";
    });
  }
  // Canvas painting
  els.grid.addEventListener("mousedown", onGridMouse);
  els.grid.addEventListener("mousemove", (e) => {
    // Paint while dragging
    if (e.buttons & 1) onGridMouse(e);
    // Hover hint
    showHoverHintOnGrid(e, /*upstairs*/ false);
  });
  els.grid.addEventListener("mouseleave", () => hideHint());
  

  // Metadata
  els.prefabId.addEventListener("input", () => state.id = (els.prefabId.value || "").trim());
  els.prefabName.addEventListener("input", () => state.name = (els.prefabName.value || "").trim());
  els.prefabTags.addEventListener("input", () => state.tags = (els.prefabTags.value || "").split(",").map(s => s.trim()).filter(Boolean));

  // Doors
  els.doorApplyBtn.addEventListener("click", () => {
    if (!state.lastDoorPaintPos) return;
    const {x,y} = state.lastDoorPaintPos;
    const d = getOrCreateDoorAt(x,y);
    d.orientation = els.doorOrient.value;
    d.type = els.doorType.value;
    d.role = els.doorRole.value;
    renderDoorList();
    lint();
  });

  // Constraints
  els.rotChecks.forEach(cb => cb.addEventListener("change", () => {
    const rots = els.rotChecks.filter(c => c.checked).map(c => parseInt(c.value,10));
    state.constraints.rotations = rots.length ? rots : [0];
    lint();
  }));
  els.mirror.addEventListener("change", () => { state.constraints.mirror = !!els.mirror.checked; lint(); });
  els.mustFaceRoad.addEventListener("change", () => { state.constraints.mustFaceRoad = !!els.mustFaceRoad.checked; });
  els.minSetback.addEventListener("input", () => { state.constraints.minSetback = clampInt(els.minSetback.value, 0, 4); });

  // Shop
  els.shopType.addEventListener("change", () => state.shop.type = els.shopType.value);
  els.shopOpen.addEventListener("change", () => { state.shop.schedule.open = els.shopOpen.value; });
  els.shopClose.addEventListener("change", () => { state.shop.schedule.close = els.shopClose.value; });
  els.shopAlways.addEventListener("change", () => { state.shop.schedule.alwaysOpen = !!els.shopAlways.checked; });
  els.shopSign.addEventListener("input", () => state.shop.signText = els.shopSign.value);

  // Upstairs
  els.upEnabled.addEventListener("change", () => { state.upstairsEnabled = !!els.upEnabled.checked; lint(); });
  els.upX.addEventListener("input", () => state.up.offset.x = clampInt(els.upX.value, 0, 30));
  els.upY.addEventListener("input", () => state.up.offset.y = clampInt(els.upY.value, 0, 30));
  els.upResizeBtn.addEventListener("click", () => {
    state.up.w = clampInt(els.upW.value, 3, 32);
    state.up.h = clampInt(els.upH.value, 3, 32);
    initUpGrid();
    drawUpGrid();
    lint();
  });
  els.upGrid.addEventListener("mousedown", onUpGridMouse);
  els.upGrid.addEventListener("mousemove", (e) => {
    if (e.buttons & 1) onUpGridMouse(e);
    showHoverHintOnGrid(e, /*upstairs*/ true);
  });
  els.upGrid.addEventListener("mouseleave", () => hideHint());

  // Export
  els.copyJSONBtn.addEventListener("click", async () => {
    const obj = buildPrefabObject();
    const txt = JSON.stringify(obj, null, 2);
    try {
      await navigator.clipboard.writeText(txt);
      setStatus("Copied JSON to clipboard.");
    } catch (_) {
      setStatus("Copy failed. You can use Download instead.");
    }
  });
  els.downloadJSONBtn.addEventListener("click", () => {
    const obj = buildPrefabObject();
    const txt = JSON.stringify(obj, null, 2);
    const url = URL.createObjectURL(new Blob([txt], {type:"application/json"}));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.id || "prefab"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus("Download started.");
  });

  // Initialize metadata fields
  syncMetadataFields();
}

function syncMetadataFields() {
  els.prefabId.value = state.id;
  els.prefabName.value = state.name;
  els.prefabTags.value = state.tags.join(",");
  els.shopType.value = state.shop.type;
  els.shopOpen.value = state.shop.schedule.open;
  els.shopClose.value = state.shop.schedule.close;
  els.shopAlways.checked = !!state.shop.schedule.alwaysOpen;
  els.shopSign.value = state.shop.signText;
  els.upEnabled.checked = !!state.upstairsEnabled;
  els.upX.value = state.up.offset.x;
  els.upY.value = state.up.offset.y;
  els.upW.value = state.up.w;
  els.upH.value = state.up.h;
  els.mirror.checked = !!state.constraints.mirror;
  els.mustFaceRoad.checked = !!state.constraints.mustFaceRoad;
  els.minSetback.value = state.constraints.minSetback;
  els.rotChecks.forEach(cb => { cb.checked = state.constraints.rotations.includes(parseInt(cb.value,10)); });
  renderDoorList();
}

function updateModeVisibility() {
  els.shopFields.style.display = (state.category === "shop") ? "" : "none";
  els.innFields.style.display = (state.category === "inn") ? "" : "none";
}

function onGridMouse(e) {
  const rect = els.grid.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left - 1) / CELL);
  const y = Math.floor((e.clientY - rect.top - 1) / CELL);
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return;
  if (state.brush === "tile") {
    state.tiles[y][x] = String(state.tileSel || "FLOOR").toUpperCase();
  } else if (state.brush === "prop") {
    state.tiles[y][x] = String(state.propSel || "TABLE").toUpperCase();
  } else if (state.brush === "door") {
    state.tiles[y][x] = "DOOR";
    state.lastDoorPaintPos = {x,y};
    const d = getOrCreateDoorAt(x,y);
    // Default values if not set
    if (!d.orientation) d.orientation = "S";
    if (!d.type) d.type = "single";
    if (!d.role) d.role = "main";
  } else if (state.brush === "erase") {
    state.tiles[y][x] = "FLOOR";
    // Remove door entry if any
    const idx = state.doors.findIndex(d => d.x === x && d.y === y);
    if (idx >= 0) state.doors.splice(idx,1);
  }
  drawGrid();
  renderDoorList();
  lint();
}

function onUpGridMouse(e) {
  const rect = els.upGrid.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left - 1) / CELL);
  const y = Math.floor((e.clientY - rect.top - 1) / CELL);
  if (x < 0 || y < 0 || x >= state.up.w || y >= state.up.h) return;
  if (state.brush === "tile") {
    state.up.tiles[y][x] = String(state.tileSel || "FLOOR").toUpperCase();
  } else if (state.brush === "prop") {
    state.up.tiles[y][x] = String(state.propSel || "TABLE").toUpperCase();
  } else if (state.brush === "erase") {
    state.up.tiles[y][x] = "FLOOR";
  }
  drawUpGrid();
  lint();
}

// ----- Hover hint helpers -----
function showHoverHintOnGrid(e, upstairs) {
  try {
    const canvas = upstairs ? els.upGrid : els.grid;
    const rect = canvas.getBoundingClientRect();
    const gx = Math.floor((e.clientX - rect.left - 1) / CELL);
    const gy = Math.floor((e.clientY - rect.top - 1) / CELL);
    const inBounds = upstairs
      ? (gx >= 0 && gy >= 0 && gx < state.up.w && gy < state.up.h)
      : (gx >= 0 && gy >= 0 && gx < state.w && gy < state.h);
    if (!inBounds) {
      hideHint();
      return;
    }
    const code = upstairs ? state.up.tiles[gy][gx] : state.tiles[gy][gx];
    const txt = hintTextFor(code);
    if (!txt) {
      hideHint();
      return;
    }
    // position near cursor, keep on-screen
    const x = Math.min(window.innerWidth - 160, Math.max(6, e.clientX + 12));
    const y = Math.min(window.innerHeight - 40, Math.max(6, e.clientY + 12));
    els.hint.style.left = `${x}px`;
    els.hint.style.top = `${y}px`;
    els.hint.textContent = txt;
    els.hint.style.display = "block";
  } catch (_) {
    // ignore
  }
}

function hintTextFor(code) {
  const key = String(code || "").toUpperCase();
  const t = state.assets.tiles[key];
  const p = state.assets.props[key];
  const def = t || p || null;
  if (!def) return key || "";
  const name = def.name || key;
  return name;
}

function hideHint() {
  if (els.hint) els.hint.style.display = "none";
}

function drawGrid() {
  const ctx = els.grid.getContext("2d");
  ctx.fillStyle = GRID_BG;
  ctx.fillRect(0,0,els.grid.width,els.grid.height);

  // Draw cells
  for (let y=0; y<state.h; y++) {
    for (let x=0; x<state.w; x++) {
      const code = state.tiles[y][x];
      drawCell(ctx, x, y, code);
      // Door pin overlay
      const d = state.doors.find(d => d.x === x && d.y === y);
      if (d) drawDoorPin(ctx, x, y);
    }
  }
  // Grid lines
  ctx.strokeStyle = GRID_LINE;
  for (let x=0; x<=state.w; x++) {
    ctx.beginPath(); ctx.moveTo(1 + x*CELL, 1); ctx.lineTo(1 + x*CELL, 1 + state.h*CELL); ctx.stroke();
  }
  for (let y=0; y<=state.h; y++) {
    ctx.beginPath(); ctx.moveTo(1, 1 + y*CELL); ctx.lineTo(1 + state.w*CELL, 1 + y*CELL); ctx.stroke();
  }
}

function drawUpGrid() {
  const ctx = els.upGrid.getContext("2d");
  ctx.fillStyle = GRID_BG;
  ctx.fillRect(0,0,els.upGrid.width,els.upGrid.height);

  for (let y=0; y<state.up.h; y++) {
    for (let x=0; x<state.up.w; x++) {
      const code = state.up.tiles[y][x];
      drawCell(ctx, x, y, code);
    }
  }
  ctx.strokeStyle = GRID_LINE;
  for (let x=0; x<=state.up.w; x++) {
    ctx.beginPath(); ctx.moveTo(1 + x*CELL, 1); ctx.lineTo(1 + x*CELL, 1 + state.up.h*CELL); ctx.stroke();
  }
  for (let y=0; y<=state.up.h; y++) {
    ctx.beginPath(); ctx.moveTo(1, 1 + y*CELL); ctx.lineTo(1 + state.up.w*CELL, 1 + y*CELL); ctx.stroke();
  }
}

function drawCell(ctx, x, y, code) {
  const left = 1 + x*CELL;
  const top = 1 + y*CELL;
  const c = String(code || "FLOOR").toUpperCase();

  // Determine if it's a tile or prop by presence in assets maps
  const tileDef = state.assets.tiles[c];
  const propDef = state.assets.props[c];
  const def = tileDef || propDef || null;

  // Background color
  let fill = "#111827";
  if (def && def.colors && def.colors.fill) fill = def.colors.fill;
  else {
    if (c === "WALL") fill = "#334155";
    else if (c === "FLOOR") fill = "#0f172a";
    else if (c === "WINDOW") fill = "#1d4ed8";
    else if (c === "STAIRS") fill = "#0f2f1f";
    else if (c === "DOOR") fill = "#3a2f1b";
    else fill = "#1a1d24";
  }
  ctx.fillStyle = fill;
  ctx.fillRect(left, top, CELL-1, CELL-1);

  // Glyph on top if available
  let glyph = def && typeof def.glyph === "string" ? def.glyph : "";
  let color = (def && def.colors && def.colors.fg) ? def.colors.fg : "#cbd5e1";
  if (glyph && String(glyph).trim().length > 0) {
    ctx.fillStyle = color;
    ctx.font = "14px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, left + (CELL-1)/2, top + (CELL-1)/2);
  } else {
    // Fallback: short code
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "11px JetBrains Mono, monospace";
    const t = c.length > 4 ? c.slice(0,4) : c;
    ctx.fillText(t, left + 3, top + 12);
  }
}

function drawDoorPin(ctx, x, y) {
  ctx.fillStyle = "#fca5a5";
  ctx.beginPath();
  ctx.arc(1 + x*CELL + CELL-8, 1 + y*CELL + 8, 3, 0, Math.PI*2);
  ctx.fill();
}

function getOrCreateDoorAt(x,y) {
  let d = state.doors.find(d => d.x === x && d.y === y);
  if (!d) { d = { x, y, orientation:"S", type:"single", role:"main" }; state.doors.push(d); }
  return d;
}

function renderDoorList() {
  els.doorsList.innerHTML = state.doors.map(d => {
    return `<div>(${d.x},${d.y}) • ${d.orientation} • ${d.type} • ${d.role}</div>`;
  }).join("");
}

function buildPrefabObject() {
  const obj = {
    id: state.id,
    name: state.name,
    category: state.category,
    tags: state.tags.slice(),
    size: { w: state.w, h: state.h },
    tiles: state.tiles.map(row => row.slice()),
    doors: state.doors.map(d => ({ x:d.x, y:d.y, orientation:d.orientation, type:d.type, role:d.role })),
    constraints: {
      rotations: state.constraints.rotations.slice(),
      mirror: !!state.constraints.mirror,
      mustFaceRoad: !!state.constraints.mustFaceRoad,
      minSetback: clampInt(state.constraints.minSetback, 0, 8),
    }
  };
  if (state.category === "shop") {
    obj.shop = {
      type: state.shop.type,
      schedule: { open: state.shop.schedule.open, close: state.shop.schedule.close, alwaysOpen: !!state.shop.schedule.alwaysOpen },
      signText: state.shop.signText || ""
    };
  }
  if (state.category === "inn" && state.upstairsEnabled) {
    obj.upstairsOverlay = {
      offset: { x: clampInt(state.up.offset.x,0,64), y: clampInt(state.up.offset.y,0,64) },
      w: state.up.w,
      h: state.up.h,
      tiles: state.up.tiles.map(row => row.slice())
    };
  }
  return obj;
}

function lint() {
  const msgs = [];
  // Perimeter walls suggested for house/shop/inn
  if (["house","shop","inn"].includes(state.category)) {
    const perOk = perimeterWallsClosed(state.tiles);
    if (!perOk) msgs.push("Hint: perimeter walls are not fully closed.");
  }
  // At least one door
  if (!state.doors.length) msgs.push("Hint: add at least one door and mark role=main.");
  // Doors near perimeter?
  const badDoors = state.doors.filter(({x,y}) => !(x === 0 || y === 0 || x === state.w-1 || y === state.h-1));
  if (badDoors.length) msgs.push("Hint: doors are typically placed on perimeter tiles.");
  // Upstairs STAIRS alignment hint
  if (state.category === "inn" && state.upstairsEnabled) {
    const stairsDown = coordsWithCode(state.tiles, "STAIRS");
    const stairsUp = coordsWithCode(state.up.tiles, "STAIRS");
    if (!stairsDown.length || !stairsUp.length) msgs.push("Hint: add STAIRS on both floors and align them.");
  }
  els.lint.innerHTML = msgs.map(s => `<div>${s}</div>`).join("");
}

function perimeterWallsClosed(tiles) {
  const h = tiles.length;
  const w = h ? tiles[0].length : 0;
  if (!h || !w) return false;
  for (let x=0; x<w; x++) {
    if (tiles[0][x] !== "WALL") return false;
    if (tiles[h-1][x] !== "WALL") return false;
  }
  for (let y=0; y<h; y++) {
    if (tiles[y][0] !== "WALL") return false;
    if (tiles[y][w-1] !== "WALL") return false;
  }
  // allow doors/windows on perimeter: relax rule slightly
  return true;
}

function coordsWithCode(tiles, code) {
  const out = [];
  for (let y=0; y<tiles.length; y++) {
    for (let x=0; x<tiles[y].length; x++) {
      if (String(tiles[y][x]).toUpperCase() === code) out.push({x,y});
    }
  }
  return out;
}

function clampInt(v, min, max) {
  const n = Math.max(min, Math.min(max, parseInt(v,10) || 0));
  return n;
}

function setStatus(text) {
  if (els.status) els.status.textContent = text || "";
}

// Rotation/mirror preview helpers removed (no longer needed)

init();