/**
 * LockpickModal: pin-grid lockpicking mini-game for town chests.
 *
 * Exports (ESM + window.LockpickModal):
 * - show(ctx, opts)
 * - hide()
 * - isOpen()
 *
 * Mechanics:
 * - Grid of vertical pins; each has a notch that must align to the shear line.
 * - Actions:
 *   - Normal nudge: moves the selected pin and its immediate neighbors one step.
 *   - Fine nudge: moves only the selected pin one step (Shift+Space/Enter).
 * - Limited moves; lockpicking skill slightly increases the move budget over time.
 * - Success: chest opens, loot granted, lockpicking skill improves, lockpick tool wears slightly.
 * - Failure: you fail to pick the lock this attempt; lockpick tool wears a bit more.
 */

import { awardTownChestLoot } from "/services/town_chest_loot.js";
import { attachGlobal } from "/utils/global.js";

let _overlay = null;
let _canvas = null;
let _ctx2d = null;
let _infoEl = null;

let _running = false;
let _gameCtx = null;

// Puzzle state
let _cols = 4;
let _rows = 5;
let _pins = [];
let _targetRow = 2;
let _selectedCol = 0;
let _movesUsed = 0;
let _movesLimit = 0;
// Fine nudge state (per attempt)
let _fineUsed = 0;
let _fineLimit = 0;

// Context for resolution
let _chestX = 0;
let _chestY = 0;
let _chestType = "chest";
let _minutesPerAttempt = 5;
let _lockpickIndex = -1;

function ensureOverlay() {
  if (_overlay) return _overlay;

  const ov = document.createElement("div");
  ov.id = "lockpick-overlay";
  ov.style.position = "fixed";
  ov.style.left = "0";
  ov.style.top = "0";
  ov.style.right = "0";
  ov.style.bottom = "0";
  ov.style.background = "rgba(6, 10, 18, 0.78)";
  ov.style.zIndex = "50020";
  ov.style.display = "none";
  ov.style.backdropFilter = "blur(1px)";

  const wrap = document.createElement("div");
  wrap.style.position = "absolute";
  wrap.style.left = "50%";
  wrap.style.top = "50%";
  wrap.style.transform = "translate(-50%, -50%)";
  wrap.style.background = "rgba(15, 18, 28, 0.96)";
  wrap.style.border = "1px solid #2b3854";
  wrap.style.borderRadius = "10px";
  wrap.style.boxShadow = "0 10px 30px rgba(0,0,0,0.55)";
  wrap.style.padding = "12px";
  wrap.style.minWidth = "360px";
  wrap.style.maxWidth = "92vw";

  const title = document.createElement("div");
  title.textContent = "Lockpicking";
  title.style.color = "#e5e7eb";
  title.style.fontSize = "16px";
  title.style.fontWeight = "600";
  title.style.marginBottom = "6px";

  const hint = document.createElement("div");
  hint.textContent = "Left/Right or A/D to choose a pin. Space/Enter: normal nudge (pin + neighbors, 1 move). Shift+Space/Enter: fine nudge (only that pin, 2 moves, limited uses; once spent, Shift+Space acts as a normal nudge). Align all notches to the shear line before you run out of moves. Esc cancels.";
  hint.style.color = "#94a3b8";
  hint.style.fontSize = "11px";
  hint.style.marginBottom = "6px";

  const info = document.createElement("div");
  info.style.color = "#cbd5e1";
  info.style.fontSize = "12px";
  info.style.marginBottom = "6px";
  _infoEl = info;

  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 220;
  canvas.style.display = "block";
  canvas.style.background = "#020617";
  canvas.style.border = "1px solid #1f2937";
  canvas.style.borderRadius = "6px";

  wrap.appendChild(title);
  wrap.appendChild(hint);
  wrap.appendChild(info);
  wrap.appendChild(canvas);
  ov.appendChild(wrap);
  document.body.appendChild(ov);

  _overlay = ov;
  _canvas = canvas;
  _ctx2d = canvas.getContext("2d");

  // Keyboard controls
  const onKey = (e) => {
    if (!_running) return;
    // Swallow all keyboard input from reaching the main game while the lockpicking modal is active.
    try {
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      else e.stopPropagation();
    } catch (_) {
      try { e.stopPropagation(); } catch (_) {}
    }
    try { e.preventDefault(); } catch (_) {}
    if (e.key === "Escape" || e.key === "Esc") {
      try {
        const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
        if (GM && typeof GM.onEvent === "function") {
          const scope = _gameCtx && _gameCtx.mode ? _gameCtx.mode : "town";
          GM.onEvent(_gameCtx, { type: "mechanic", scope, mechanic: "lockpicking", action: "dismiss" });
        }
      } catch (_) {}
      hide();
      return;
    }
    if (e.type !== "keydown") return;

    const key = e.key;
    const lower = key ? key.toLowerCase() : "";

    if (key === "ArrowLeft" || lower === "a") {
      e.preventDefault();
      _selectedCol = (_selectedCol - 1 + _cols) % _cols;
      draw();
      updateInfo();
      return;
    }
    if (key === "ArrowRight" || lower === "d") {
      e.preventDefault();
      _selectedCol = (_selectedCol + 1) % _cols;
      draw();
      updateInfo();
      return;
    }

    if (key === " " || lower === " " || key === "Spacebar" || key === "Enter") {
      e.preventDefault();
      const fine = !!e.shiftKey;
      applyMove(fine ? "fine" : "normal");
      return;
    }
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);

  // Mouse: click to select a column, Shift+click to fine nudge, plain click to normal nudge.
  const onClick = (e) => {
    if (!_running) return;
    e.preventDefault();
    e.stopPropagation();
    if (!_canvas) return;
    const rect = _canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Map x into column index
    const gridLeft = Math.floor(_canvas.width * 0.12);
    const gridRight = Math.floor(_canvas.width * 0.88);
    const gridW = gridRight - gridLeft;
    if (x < gridLeft || x > gridRight) {
      return;
    }
    const colWidth = gridW / _cols;
    const col = Math.max(0, Math.min(_cols - 1, Math.floor((x - gridLeft) / colWidth)));
    _selectedCol = col;
    draw();
    updateInfo();
    const fine = !!e.shiftKey || e.button === 2;
    applyMove(fine ? "fine" : "normal");
  };
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("contextmenu", (e) => {
    if (!_running) return;
    e.preventDefault();
    e.stopPropagation();
  });

  // Clicking dim background closes the modal
  ov.addEventListener("click", (e) => {
    if (e.target === ov) {
      try {
        const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
        if (GM && typeof GM.onEvent === "function") {
          const scope = _gameCtx && _gameCtx.mode ? _gameCtx.mode : "town";
          GM.onEvent(_gameCtx, { type: "mechanic", scope, mechanic: "lockpicking", action: "dismiss" });
        }
      } catch (_) {}
      hide();
      e.stopPropagation();
    }
  });

  return ov;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function updateInfo() {
  if (!_infoEl || !_gameCtx) return;
  const s = (_gameCtx.player && _gameCtx.player.skills) ? _gameCtx.player.skills : {};
  const lpUses = Math.floor(s.lockpicking || 0);
  const movesLeft = Math.max(0, _movesLimit - _movesUsed);
  const fineMax = Math.max(0, _fineLimit | 0);
  const fineUsed = Math.max(0, _fineUsed | 0);
  _infoEl.textContent = `Moves: ${_movesUsed}/${_movesLimit} (left ${movesLeft}) • Fine: ${fineUsed}/${fineMax} • Lockpicking uses: ${lpUses}`;
}

// Initialize puzzle state based on player skill
function setupPuzzle(ctx, opts) {
  _gameCtx = ctx || null;
  _cols = 4;
  _rows = 5;
  _targetRow = Math.floor(_rows / 2);

  const s = (ctx && ctx.player && ctx.player.skills) ? ctx.player.skills : {};
  const lockSkill = Math.max(0, (s.lockpicking || 0));
  // Base moves + a small bonus from experience (up to +6 moves)
  const baseMoves = 8;
  const bonusMoves = Math.min(6, Math.floor(lockSkill / 3));
  _movesLimit = baseMoves + bonusMoves;
  _movesUsed = 0;

  // Fine nudges: limited, with capacity growing slowly with experience (1–4 per lock)
  const fineExtra = Math.min(3, Math.floor(lockSkill / 15));
  _fineLimit = 1 + Math.max(0, fineExtra);
  _fineUsed = 0;

  // INT: slight bonus to move and fine-nudge budget.
  try {
    const p = ctx && ctx.player ? ctx.player : null;
    const attrs = p && p.attributes ? p.attributes : null;
    const intVal = attrs && typeof attrs.int === "number" ? attrs.int : 0;
    const n = intVal | 0;
    const nonNeg = n < 0 ? 0 : n;
    const intMovesBonus = Math.min(4, Math.floor(nonNeg / 5));   // +1 move per 5 INT, up to +4
    const intFineBonus  = Math.min(2, Math.floor(nonNeg / 10));  // +1 fine per 10 INT, up to +2
    _movesLimit += intMovesBonus;
    _fineLimit = Math.max(0, (_fineLimit | 0) + intFineBonus);
  } catch (_) {}

  _pins = [];
  for (let c = 0; c < _cols; c++) {
    let row = Math.floor(Math.random() * _rows);
    _pins.push(row);
  }
  // Ensure not already solved
  if (_pins.every((r) => r === _targetRow)) {
    for (let i = 0; i < _cols; i++) {
      _pins[i] = (_pins[i] + 1) % _rows;
    }
  }

  _selectedCol = 0;
  _minutesPerAttempt = (opts && typeof opts.minutesPerAttempt === "number")
    ? clamp(opts.minutesPerAttempt | 0, 1, 30)
    : 5;

  // Chest position/type for removal on success
  _chestX = (opts && typeof opts.x === "number") ? (opts.x | 0) : 0;
  _chestY = (opts && typeof opts.y === "number") ? (opts.y | 0) : 0;
  _chestType = (opts && typeof opts.type === "string" && opts.type) ? opts.type : "chest";

  // Resolve which lockpick tool we are using (first match)
  _lockpickIndex = -1;
  try {
    const inv = ctx && ctx.player && Array.isArray(ctx.player.inventory) ? ctx.player.inventory : null;
    if (inv) {
      for (let i = 0; i < inv.length; i++) {
        const it = inv[i];
        if (!it) continue;
        const kind = String(it.kind || "").toLowerCase();
        const type = String(it.type || "").toLowerCase();
        const name = String(it.name || "").toLowerCase();
        if (kind === "tool" && (type === "lockpick" || name.includes("lockpick"))) {
          _lockpickIndex = i;
          break;
        }
      }
    }
  } catch (_) {}
}

function draw() {
  const g = _ctx2d;
  if (!g || !_canvas) return;
  const w = _canvas.width;
  const h = _canvas.height;

  g.clearRect(0, 0, w, h);

  // Background
  g.fillStyle = "#020617";
  g.fillRect(0, 0, w, h);

  // Frame
  g.strokeStyle = "#1f2937";
  g.strokeRect(0.5, 0.5, w - 1, h - 1);

  const gridLeft = Math.floor(w * 0.12);
  const gridRight = Math.floor(w * 0.88);
  const gridTop = Math.floor(h * 0.18);
  const gridBottom = Math.floor(h * 0.86);
  const gridW = gridRight - gridLeft;
  const gridH = gridBottom - gridTop;
  const colW = gridW / _cols;
  const rowH = gridH / (_rows - 1 || 1);

  // Shear line
  const shearY = gridTop + rowH * _targetRow;
  g.strokeStyle = "rgba(248, 250, 252, 0.4)";
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(gridLeft - 8, shearY + 0.5);
  g.lineTo(gridRight + 8, shearY + 0.5);
  g.stroke();
  g.setLineDash([]);

  // Labels
  g.fillStyle = "#94a3b8";
  g.font = "11px JetBrains Mono, monospace";
  g.fillText("Shear line", gridLeft, shearY - 6);

  // Columns and pins
  for (let c = 0; c < _cols; c++) {
    const cx = gridLeft + colW * (c + 0.5);

    // Column highlight if selected
    if (c === _selectedCol) {
      g.fillStyle = "rgba(37, 99, 235, 0.14)";
      g.fillRect(gridLeft + colW * c + 2, gridTop, colW - 4, gridH);
      g.strokeStyle = "rgba(96, 165, 250, 0.9)";
      g.strokeRect(gridLeft + colW * c + 2.5, gridTop + 0.5, colW - 5, gridH - 1);
    }

    // Column line
    g.strokeStyle = "#111827";
    g.beginPath();
    g.moveTo(cx + 0.5, gridTop);
    g.lineTo(cx + 0.5, gridBottom);
    g.stroke();

    // Notch
    const notchRow = clamp(_pins[c], 0, _rows - 1);
    const ny = gridTop + notchRow * rowH;
    const radius = Math.max(4, Math.min(8, rowH * 0.35));
    const inPlace = (notchRow === _targetRow);

    g.beginPath();
    g.arc(cx, ny, radius, 0, Math.PI * 2);
    g.fillStyle = inPlace ? "#22c55e" : "#e5e7eb";
    g.fill();
    g.strokeStyle = inPlace ? "#16a34a" : "#9ca3af";
    g.stroke();
  }

  // Moves / hint area
  g.fillStyle = "#94a3b8";
  g.font = "11px JetBrains Mono, monospace";
  const movesLeft = Math.max(0, _movesLimit - _movesUsed);
  const fineMax = Math.max(0, _fineLimit | 0);
  const fineUsed = Math.max(0, _fineUsed | 0);
  g.fillText(`Moves ${_movesUsed}/${_movesLimit} (left ${movesLeft}) • Fine ${fineUsed}/${fineMax}`, gridLeft, gridTop - 10);
  g.fillText(`Selected pin: ${_selectedCol + 1}/${_cols}`, gridLeft, gridBottom + 14);
}

function allAligned() {
  if (!_pins || !_pins.length) return false;
  for (let i = 0; i < _pins.length; i++) {
    if (_pins[i] !== _targetRow) return false;
  }
  return true;
}

function decayLockpick(ctx, success) {
  if (!ctx || _lockpickIndex < 0) return;
  try {
    const inv = ctx.player && Array.isArray(ctx.player.inventory) ? ctx.player.inventory : null;
    if (!inv || _lockpickIndex >= inv.length) return;
    const it = inv[_lockpickIndex];
    if (!it) return;
    if (typeof it.decay !== "number") {
      if (typeof it.durability === "number") {
        const d = clamp(100 - (it.durability | 0), 0, 100);
        it.decay = d;
      } else {
        it.decay = 0;
      }
    }
    const baseAmt = success ? 1 : 2;
    const extraFine = Math.max(0, _fineUsed | 0); // extra wear from precise nudges this attempt
    const amt = clamp(baseAmt + extraFine, 0, 100);
    const before = it.decay | 0;
    it.decay = clamp((it.decay || 0) + amt, 0, 100);
    if (it.decay >= 100) {
      inv.splice(_lockpickIndex, 1);
      _lockpickIndex = -1;
      try { if (ctx.log) ctx.log("Your lockpick snaps.", "info"); } catch (_) {}
    } else if ((it.decay | 0) !== before) {
      try { if (typeof ctx.rerenderInventoryIfOpen === "function") ctx.rerenderInventoryIfOpen(); } catch (_) {}
    }
  } catch (_) {}
}

function awardLockpickingSkill(ctx, success) {
  if (!ctx || !ctx.player) return;
  try {
    ctx.player.skills = ctx.player.skills || {};
    const base = ctx.player.skills.lockpicking || 0;
    ctx.player.skills.lockpicking = base + (success ? 2 : 1);
  } catch (_) {}
}

function awardChestLoot(ctx) {
  return awardTownChestLoot(ctx);
}

function markChestOpened(ctx) {
  if (!ctx || !Array.isArray(ctx.townProps)) return;
  try {
    const keyType = String(_chestType || "").toLowerCase();
    const chest = ctx.townProps.find(p =>
      p &&
      p.x === _chestX &&
      p.y === _chestY &&
      String(p.type || "").toLowerCase() === keyType
    );
    if (chest) {
      chest.opened = true;
    }
  } catch (_) {}
}

function finish(success) {
  const ctx = _gameCtx;
  _running = false;

  if (ctx) {
    // Advance time for the attempt
    try {
      if (typeof ctx.advanceTimeMinutes === "function") {
        ctx.advanceTimeMinutes(_minutesPerAttempt);
      } else if (typeof window !== "undefined" && window.GameAPI && typeof window.GameAPI.advanceMinutes === "function") {
        window.GameAPI.advanceMinutes(_minutesPerAttempt);
      }
    } catch (_) {}

    awardLockpickingSkill(ctx, success);
    decayLockpick(ctx, success);

    if (success) {
      const loot = awardChestLoot(ctx);
      markChestOpened(ctx);
      try {
        const parts = [];
        if (loot && loot.gold > 0) parts.push(`${loot.gold} gold`);
        if (loot && loot.items && loot.items.length) parts.push(loot.items.join(", "));
        const detail = parts.length ? ` Inside you find ${parts.join(" and ")}.` : " It was mostly empty.";
        if (ctx.log) ctx.log("You pick the lock and open the chest." + detail, "good");
      } catch (_) {}
    } else {
      try {
        if (ctx.log) ctx.log("The tumblers slip out of place. You fail to pick the lock this time.", "warn");
      } catch (_) {}
    }

    // GMRuntime: lockpicking mechanic outcome
    try {
      const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
      if (GM && typeof GM.onEvent === "function") {
        const scope = _gameCtx && _gameCtx.mode ? _gameCtx.mode : "town";
        GM.onEvent(_gameCtx, { type: "mechanic", scope, mechanic: "lockpicking", action: success ? "success" : "failure" });
      }
    } catch (_) {}

    try {
      if (typeof ctx.updateUI === "function") ctx.updateUI();
    } catch (_) {}
  }

  hide();
}

function applyMove(kind) {
  if (!_running) return;
  if (_movesUsed >= _movesLimit) return;

  const col = clamp(_selectedCol, 0, _cols - 1);
  const delta = 1; // always move one step (wrap-around)
  const stepCol = (c) => {
    if (c < 0 || c >= _cols) return;
    const current = _pins[c] | 0;
    _pins[c] = (current + delta + _rows) % _rows;
  };

  // Determine whether this is a fine or normal nudge, degrading to normal when out of fine charges.
  let mode = kind === "fine" ? "fine" : "normal";
  const fineMax = Math.max(0, _fineLimit | 0);
  if (mode === "fine" && (fineMax <= 0 || _fineUsed >= fineMax)) {
    mode = "normal";
  }

  if (mode === "fine") {
    stepCol(col);
    _fineUsed += 1;
  } else {
    stepCol(col);
    stepCol(col - 1);
    stepCol(col + 1);
  }

  const moveCost = mode === "fine" ? 2 : 1;
  _movesUsed += moveCost;
  draw();
  updateInfo();

  if (allAligned()) {
    finish(true);
  } else if (_movesUsed >= _movesLimit) {
    finish(false);
  }
}

export function show(ctx, opts = {}) {
  ensureOverlay();
  if (!ctx || !ctx.player) {
    return;
  }

  // Verify player has a lockpick tool; if not, show a message and bail.
  let hasLockpick = false;
  try {
    const inv = Array.isArray(ctx.player.inventory) ? ctx.player.inventory : [];
    for (let i = 0; i < inv.length; i++) {
      const it = inv[i];
      if (!it) continue;
      const kind = String(it.kind || "").toLowerCase();
      const type = String(it.type || "").toLowerCase();
      const name = String(it.name || "").toLowerCase();
      if (kind === "tool" && (type === "lockpick" || name.includes("lockpick"))) {
        hasLockpick = true;
        break;
      }
    }
  } catch (_) {}

  if (!hasLockpick) {
    try {
      if (ctx.log) ctx.log("You will need a lockpick to work this lock.", "info");
    } catch (_) {}
    return;
  }

  setupPuzzle(ctx, opts);

  // GMRuntime: lockpicking mechanic seen/tried
  try {
    const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
    if (GM && typeof GM.onEvent === "function") {
      const scope = ctx && ctx.mode ? ctx.mode : "town";
      GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "lockpicking", action: "seen" });
      GM.onEvent(ctx, { type: "mechanic", scope, mechanic: "lockpicking", action: "tried" });
    }
  } catch (_) {}

  _running = true;
  _overlay.style.display = "block";
  draw();
  updateInfo();
}

export function hide() {
  _running = false;
  try {
    if (_overlay) _overlay.style.display = "none";
  } catch (_) {}
}

export function isOpen() {
  try { return !!(_overlay && _overlay.style.display !== "none"); } catch (_) { return false; }
}

attachGlobal("LockpickModal", { show, hide, isOpen });
