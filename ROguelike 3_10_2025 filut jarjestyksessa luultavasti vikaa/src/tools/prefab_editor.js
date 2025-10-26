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
  rotationPreview: 0,
  mirrorPreview: false,
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
  loadJCDocs();
  bindUI();
  drawGrid();
  drawUpGrid();
  updateModeVisibility();
  lint();
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
  els.fillFloorBtn = document.getElementById("fill-floor-btn");
  els.perimeterWallsBtn = document.getElementById("perimeter-walls-btn");
  els.grid = document.getElementById("grid");
  els.previewRot0 = document.getElementById("preview-rot-0");
  els.previewRot90 = document.getElementById("preview-rot-90");
  els.previewRot180 = document.getElementById("preview-rot-180");
  els.previewRot270 = document.getElementById("preview-rot-270");
  els.previewMirror = document.getElementById("preview-mirror");

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
    renderPalettes();
  } catch (e) {
    // Fallback palette
    state.jcdocs.tiles = ["WALL","FLOOR","DOOR","WINDOW","STAIRS"];
    state.jcdocs.embeddedPropCodes = ["BED","TABLE","CHAIR","SHELF","COUNTER","FIREPLACE","CHEST","CRATE","BARREL","PLANT","RUG","QUEST_BOARD","STALL","LAMP","WELL"];
    renderPalettes();
  }
}

function renderPalettes() {
  // Tiles
  els.tilePalette.innerHTML = "";
  state.jcdocs.tiles.forEach(code => {
    const btn = document.createElement("button");
    btn.className = "chip" + (state.tileSel === code ? " active" : "");
    btn.textContent = code;
    btn.addEventListener("click", () => {
      state.tileSel = code;
      Array.from(els.tilePalette.children).forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
    });
    els.tilePalette.appendChild(btn);
  });
  // Props
  els.propPalette.innerHTML = "";
  state.jcdocs.embeddedPropCodes.forEach(code => {
    const btn = document.createElement("button");
    btn.className = "chip" + (state.propSel === code ? " active" : "");
    btn.textContent = code;
    btn.addEventListener("click", () => {
      state.propSel = code;
      Array.from(els.propPalette.children).forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
    });
    els.propPalette.appendChild(btn);
  });
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
  els.fillFloorBtn.addEventListener("click", () => {
    for (let y=0; y<state.h; y++) for (let x=0; x<state.w; x++) state.tiles[y][x] = "FLOOR";
    drawGrid();
    lint();
  });
  els.perimeterWallsBtn.addEventListener("click", () => {
    for (let x=0; x<state.w; x++) { state.tiles[0][x] = "WALL"; state.tiles[state.h-1][x] = "WALL"; }
    for (let y=0; y<state.h; y++) { state.tiles[y][0] = "WALL"; state.tiles[y][state.w-1] = "WALL"; }
    drawGrid();
    lint();
  });
  // Canvas painting
  els.grid.addEventListener("mousedown", onGridMouse);
  els.grid.addEventListener("mousemove", (e) => { if (e.buttons & 1) onGridMouse(e); });
  // Preview
  els.previewRot0.addEventListener("click", () => { state.rotationPreview = 0; drawGrid(); });
  els.previewRot90.addEventListener("click", () => { state.rotationPreview = 90; drawGrid(); });
  els.previewRot180.addEventListener("click", () => { state.rotationPreview = 180; drawGrid(); });
  els.previewRot270.addEventListener("click", () => { state.rotationPreview = 270; drawGrid(); });
  els.previewMirror.addEventListener("click", () => { state.mirrorPreview = !state.mirrorPreview; drawGrid(); });

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
  els.upGrid.addEventListener("mousemove", (e) => { if (e.buttons & 1) onUpGridMouse(e); });

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

function drawGrid() {
  const ctx = els.grid.getContext("2d");
  ctx.fillStyle = GRID_BG;
  ctx.fillRect(0,0,els.grid.width,els.grid.height);

  // Apply preview transform
  const m = makeTransformed(state.tiles, state.rotationPreview, state.mirrorPreview);
  // Draw cells
  for (let y=0; y<state.h; y++) {
    for (let x=0; x<state.w; x++) {
      const code = m[y][x];
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
  // Base color by code
  const c = String(code || "FLOOR").toUpperCase();
  let fill = "#111827";
  if (c === "WALL") fill = "#334155";
  else if (c === "FLOOR") fill = "#0f172a";
  else if (c === "WINDOW") fill = "#1d4ed8";
  else if (c === "STAIRS") fill = "#10b981";
  else if (c === "DOOR") fill = "#a16207";
  else {
    // embedded props: different hue
    fill = "#4b5563";
  }
  ctx.fillStyle = fill;
  ctx.fillRect(left, top, CELL-1, CELL-1);
  // Label
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "11px JetBrains Mono, monospace";
  const t = c.length > 5 ? c.slice(0,5) : c;
  ctx.fillText(t, left + 3, top + 12);
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

// Transform helper (rotation + mirror) for preview only
function makeTransformed(a, rot, mirror) {
  const h = a.length; const w = h ? a[0].length : 0;
  let m = a.map(row => row.slice());
  if (mirror) {
    m = m.map(row => row.slice().reverse());
  }
  const r = (rot || 0) % 360;
  if (r === 0) return m;
  if (r === 90) {
    const out = Array.from({length:w}, () => Array.from({length:h}, () => "FLOOR"));
    for (let y=0; y<h; y++) for (let x=0; x<w; x++) out[x][h-1-y] = m[y][x];
    // normalize dimensions to original preview frame (crop/scale)
    return cropOrPad(out, h, w);
  } else if (r === 180) {
    const out = Array.from({length:h}, () => Array.from({length:w}, () => "FLOOR"));
    for (let y=0; y<h; y++) for (let x=0; x<w; x++) out[h-1-y][w-1-x] = m[y][x];
    return out;
  } else if (r === 270) {
    const out = Array.from({length:w}, () => Array.from({length:h}, () => "FLOOR"));
    for (let y=0; y<h; y++) for (let x=0; x<w; x++) out[w-1-x][y] = m[y][x];
    return cropOrPad(out, h, w);
  }
  return m;
}

function cropOrPad(arr, targetH, targetW) {
  // For preview only: center-crop or pad to fit original canvas frame
  const h = arr.length, w = h ? arr[0].length : 0;
  if (h === targetH && w === targetW) return arr;
  const out = Array.from({length: targetH}, () => Array.from({length: targetW}, () => "FLOOR"));
  const offY = Math.floor((targetH - h) / 2);
  const offX = Math.floor((targetW - w) / 2);
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    const yy = y + offY; const xx = x + offX;
    if (yy >= 0 && yy < targetH && xx >= 0 && xx < targetW) out[yy][xx] = arr[y][x];
  }
  return out;
}

init();