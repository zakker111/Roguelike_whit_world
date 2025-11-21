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
  // brush
  brush: "tile", // tile|prop|erase
  tileSel: "FLOOR",
  propSel: "BED",
  // metadata
  id: "house_small_custom_1",
  name: "Custom Small House",
  tags: ["residential","single_story"],
  // shop
  shop: { type: "blacksmith", schedule: { open: "08:00", close: "17:00", alwaysOpen: false }, signText: "Blacksmith", sign: true },
  // upstairs
  upstairsEnabled: false,
  up: { offset: {x:1,y:1}, w:9, h:7, tiles: [] },
  // loaded prefabs from data/worldgen/prefabs.json
  prefabs: { houses: [], shops: [], inns: [], plazas: [] },
  // palettes
  jcdocs: { tiles: [], embeddedPropCodes: [] },
  // assets lookup (glyphs/colors) loaded from data/world/world_assets.json
  assets: { tiles: Object.create(null), props: Object.create(null) },
};

const els = {};
const CELL = 24; // px cell size
const GRID_BG = "#0b0c10";
const GRID_LINE = "rgba(255,255,255,0.06)";

function init() {
  bindEls();
  initGrid();
  initUpGrid();
  // Load palettes, prefabs and glyph/color assets
  Promise.all([loadJCDocs(), loadAssets()]).then(() => {
    renderPalettes();
    populatePrefabLoadList();
    drawGrid();
    drawUpGrid();
    updateModeVisibility();
    lint();
  }).catch(() => {
    renderPalettes();
    populatePrefabLoadList();
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
  els.tilePalette = document.getElementById("tile-palette");
  els.propPalette = document.getElementById("prop-palette");
  els.eraseBtn = document.getElementById("erase-brush-btn");
  els.grid = document.getElementById("grid");

  els.prefabLoad = document.getElementById("prefab-load");
  els.prefabLoadBtn = document.getElementById("prefab-load-btn");

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

    // Cache existing prefabs for loading into the editor
    state.prefabs = {
      houses: Array.isArray(json.houses) ? json.houses : [],
      shops: Array.isArray(json.shops) ? json.shops : [],
      inns: Array.isArray(json.inns) ? json.inns : [],
      plazas: Array.isArray(json.plazas) ? json.plazas : [],
    };
  } catch (e) {
    // Fallback palette
    state.jcdocs.tiles = ["WALL","FLOOR","DOOR","WINDOW","STAIRS"];
    state.jcdocs.embeddedPropCodes = ["BED","TABLE","CHAIR","SHELF","COUNTER","FIREPLACE","CHEST","CRATE","BARREL","PLANT","RUG","QUEST_BOARD","STALL","LAMP","WELL"];
    state.prefabs = { houses: [], shops: [], inns: [], plazas: [] };
  }
}

function populatePrefabLoadList() {
  if (!els.prefabLoad) return;
  const sel = els.prefabLoad;
  sel.innerHTML = "";
  const optNone = document.createElement("option");
  optNone.value = "";
  optNone.textContent = "(none)";
  sel.appendChild(optNone);

  const pf = state.prefabs || {};
  const cat = state.category || (els.category ? els.category.value : "house");
  let list = [];
  if (cat === "house") list = pf.houses || [];
  else if (cat === "shop") list = pf.shops || [];
  else if (cat === "inn") list = pf.inns || [];
  else if (cat === "plaza") list = pf.plazas || [];

  list.forEach(p => {
    if (!p || !p.id) return;
    const opt = document.createElement("option");
    opt.value = String(p.id);
    opt.textContent = p.name ? `${p.id} — ${p.name}` : String(p.id);
    sel.appendChild(opt);
  });
}

function loadPrefabIntoState(prefab) {
  if (!prefab || !prefab.size || !Array.isArray(prefab.tiles)) return;
  const cat = String(prefab.category || state.category || "house");
  state.category = cat;
  if (els.category) els.category.value = cat;

  state.id = String(prefab.id || state.id || "");
  state.name = String(prefab.name || state.name || "");
  state.tags = Array.isArray(prefab.tags) ? prefab.tags.slice() : [];

  state.w = prefab.size.w | 0;
  state.h = prefab.size.h | 0;
  if (els.gridW) els.gridW.value = String(state.w);
  if (els.gridH) els.gridH.value = String(state.h);

  initGrid();
  for (let y = 0; y < state.h; y++) {
    const row = Array.isArray(prefab.tiles[y]) ? prefab.tiles[y] : [];
    state.tiles[y] = row.slice(0, state.w).map(s => String(s).toUpperCase());
  }

  // Shop / inn metadata if present
  if (prefab.shop && (cat === "shop" || cat === "inn")) {
    const s = prefab.shop || {};
    const sched = s.schedule || {};
    const open = typeof sched.open === "string" ? sched.open : "08:00";
    const close = typeof sched.close === "string" ? sched.close : "17:00";
    const alwaysOpen = !!sched.alwaysOpen;
    state.shop = {
      type: s.type || (cat === "inn" ? "inn" : "shop"),
      schedule: { open, close, alwaysOpen },
      signText: s.signText || (s.type || ""),
      sign: (typeof s.sign === "boolean") ? s.sign : true
    };
  }

  // Upstairs overlay for inns
  state.upstairsEnabled = false;
  if (cat === "inn" && prefab.upstairsOverlay && Array.isArray(prefab.upstairsOverlay.tiles)) {
    const ov = prefab.upstairsOverlay;
    const off = ov.offset || {};
    state.upstairsEnabled = true;
    state.up.offset.x = clampInt((off.x != null ? off.x : off.ox) ?? 0, 0, 64);
    state.up.offset.y = clampInt((off.y != null ? off.y : off.oy) ?? 0, 0, 64);
    state.up.w = (ov.w | 0) || (ov.tiles[0] ? ov.tiles[0].length : state.up.w);
    state.up.h = (ov.h | 0) || ov.tiles.length;
    initUpGrid();
    state.up.tiles = ov.tiles.map(row => (Array.isArray(row) ? row.slice() : []));
  }

  syncMetadataFields();
  updateModeVisibility();
  drawGrid();
  drawUpGrid();
  lint();
  setStatus(`Loaded prefab: ${state.id}`);
}

function loadSelectedPrefab() {
  if (!els.prefabLoad) return;
  const id = els.prefabLoad.value;
  if (!id) {
    setStatus("Select a prefab to load.");
    return;
  }
  const pf = state.prefabs || {};
  let list = [];
  if (state.category === "house") list = pf.houses || [];
  else if (state.category === "shop") list = pf.shops || [];
  else if (state.category === "inn") list = pf.inns || [];
  else if (state.category === "plaza") list = pf.plazas || [];

  let prefab = list.find(p => p && String(p.id) === id);
  if (!prefab) {
    const all = []
      .concat(pf.houses || [], pf.shops || [], pf.inns || [], pf.plazas || []);
    prefab = all.find(p => p && String(p.id) === id);
  }
  if (!prefab) {
    setStatus(`Prefab '${id}' not found.`);
    return;
  }
  loadPrefabIntoState(prefab);
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
      // auto-select tile mode (implicit, no brush UI)
      state.brush = "tile";
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
      // auto-select prop mode (implicit, no brush UI)
      state.brush = "prop";
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
      state.shop = { type:"blacksmith", schedule:{open:"08:00", close:"17:00", alwaysOpen:false}, signText:"Blacksmith", sign: true };
    } else if (state.category === "inn") {
      state.id = "inn_tavern_custom"; state.name = "Inn & Tavern (Custom)";
      state.tags = ["two_story","tavern"];
      // Ensure inn prefabs always include shop metadata with 24/7 schedule
      state.shop = { type:"inn", schedule:{open:"00:00", close:"00:00", alwaysOpen:true}, signText:"Inn", sign: true };
    } else if (state.category === "plaza") {
      state.id = "plaza_custom_1"; state.name = "Plaza (Custom)";
      state.tags = ["plaza"];
      // Ensure upstairs overlay disabled and shop meta hidden
      state.upstairsEnabled = false;
    }
    syncMetadataFields();
    updateModeVisibility();
    populatePrefabLoadList();
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
  if (els.eraseBtn) {
    els.eraseBtn.addEventListener("click", () => {
      state.brush = "erase";
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

  if (els.prefabLoadBtn) {
    els.prefabLoadBtn.addEventListener("click", () => {
      loadSelectedPrefab();
    });
  }

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
    const txt = buildPrefabJSONString();
    try {
      await navigator.clipboard.writeText(txt);
      setStatus("Copied JSON to clipboard.");
    } catch (_) {
      setStatus("Copy failed. You can use Download instead.");
    }
  });
  els.downloadJSONBtn.addEventListener("click", () => {
    const txt = buildPrefabJSONString();
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
    const sel = String(state.tileSel || "FLOOR").toUpperCase();
    state.tiles[y][x] = sel;
  } else if (state.brush === "prop") {
    state.tiles[y][x] = String(state.propSel || "TABLE").toUpperCase();
  } else if (state.brush === "erase") {
    state.tiles[y][x] = "FLOOR";
  }
  drawGrid();
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
    // No text fallback in editor: show background only when glyph is absent
  }
}

// Door metadata controls removed; DOOR tiles are embedded directly in the grid.
// Placement/runtime can infer door semantics from the grid if needed.

function buildPrefabObject() {
  const obj = {
    id: state.id,
    name: state.name,
    category: state.category,
    tags: state.tags.slice(),
    size: { w: state.w, h: state.h },
    tiles: state.tiles.map(row => row.slice()),
    // Default, simplified constraints (editor UI removed)
    constraints: {
      rotations: [0, 90, 180, 270],
      mirror: true,
      mustFaceRoad: true,
      minSetback: 1,
    }
  };
  if (state.category === "shop") {
    obj.shop = {
      type: state.shop.type,
      schedule: { open: state.shop.schedule.open, close: state.shop.schedule.close, alwaysOpen: !!state.shop.schedule.alwaysOpen },
      signText: state.shop.signText || "",
      sign: (typeof state.shop.sign === "boolean") ? state.shop.sign : true
    };
  }
  // For inns, include shop metadata with alwaysOpen schedule by default
  if (state.category === "inn") {
    obj.shop = {
      type: "inn",
      schedule: { alwaysOpen: true },
      signText: state.shop && state.shop.signText ? state.shop.signText : "Inn",
      sign: (state.shop && typeof state.shop.sign === "boolean") ? state.shop.sign : true
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

// Build a pretty JSON string with tiles rows on separate lines
function buildPrefabJSONString() {
  const obj = buildPrefabObject();
  // Placeholders for pretty arrays
  const TILE_MARK = "__TILES__";
  const UP_MARK = "__UPTILES__";

  const shallow = JSON.parse(JSON.stringify(obj));
  shallow.tiles = TILE_MARK;
  if (shallow.upstairsOverlay && Array.isArray(obj.upstairsOverlay?.tiles)) {
    shallow.upstairsOverlay.tiles = UP_MARK;
  }

  let base = JSON.stringify(shallow, null, 2);

  // Replace tiles placeholder with formatted array preserving indentation
  base = replaceArrayPlaceholder(base, TILE_MARK, obj.tiles);
  if (obj.upstairsOverlay && Array.isArray(obj.upstairsOverlay.tiles)) {
    base = replaceArrayPlaceholder(base, UP_MARK, obj.upstairsOverlay.tiles);
  }
  return base;
}

function replaceArrayPlaceholder(src, marker, rows) {
  const token = `"${marker}"`;
  const idx = src.indexOf(token);
  if (idx === -1) return src;
  // Determine indentation spaces at start of this line (not including the key)
  const lineStart = src.lastIndexOf("\n", idx) + 1;
  const beforeToken = src.slice(lineStart, idx); // e.g., '  "tiles": '
  const indentSpacesMatch = beforeToken.match(/^[ \t]*/);
  const indentSpaces = indentSpacesMatch ? indentSpacesMatch[0] : "";
  const pretty = formatRowsArray(rows, indentSpaces);
  return src.replace(token, pretty);
}

function formatRowsArray(rows, indentSpaces) {
  // indentSpaces is the base indentation of the line containing `"key": <value>`
  const inner = indentSpaces + "  ";
  let out = "[\n";
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] || [];
    const line = inner + "[" + row.map(s => JSON.stringify(String(s))).join(",") + "]";
    out += line;
    if (y < rows.length - 1) out += ",\n";
    else out += "\n";
  }
  out += indentSpaces + "]";
  return out;
}

function lint() {
  const msgs = [];
  // Perimeter walls suggested for house/shop/inn
  const bldCat = ["house","shop","inn"];
  if (bldCat.includes(state.category)) {
    const perOk = perimeterWallsClosed(state.tiles);
    if (!perOk) msgs.push("Hint: perimeter walls are not fully closed.");
    // At least one DOOR on perimeter recommended for buildings
    const doors = coordsWithCode(state.tiles, "DOOR");
    if (doors.length === 0) {
      msgs.push("Hint: add at least one DOOR on the perimeter.");
    } else {
      const perDoor = doors.some(({x,y}) => (x === 0 || y === 0 || x === state.w-1 || y === state.h-1));
      if (!perDoor) msgs.push("Hint: place at least one DOOR on the perimeter.");
    }
  }
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