/**
 * FishingModal: real-time "hold-the-bar" fishing mini-game.
 *
 * Exports (ESM + window.FishingModal):
 * - show(ctx, opts)
 * - hide()
 * - isOpen()
 *
 * Notes:
 * - Deterministic per-attempt: use ctx.rng to seed a local PRNG for drift/jitter.
 * - Input: Space/Enter/mouse/touch press to raise marker; release to lower.
 */

let _overlay = null;
let _canvas = null;
let _ctx2d = null;
let _raf = 0;
let _running = false;
let _press = false;
let _onDone = null;
let _gameCtx = null;

// Mini-game state
let _marker = 0.5;     // 0..1 bottom..top
let _zoneCenter = 0.5; // 0..1
let _zoneSize = 0.28;  // current effective size (may pulse)
let _progress = 0.0;   // 0..1
let _stress = 0.0;     // 0..1
let _seedRng = null;   // local rng for jitter
let _lastTs = 0;

// Wilder dynamics
let _zoneSizeBase = 0.28;  // baseline size before pulsing
let _zoneSpeedBase = 0.15; // baseline drift speed
let _pulseT = 0;           // oscillator time for size pulsing
let _dashT = 0;            // seconds left in current dash
let _nextDash = 0;         // seconds until next dash
let _dashDir = 1;          // dash direction (-1 or +1)

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Deterministic local PRNG
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromCtx(ctx) {
  let s = 0x12345678 >>> 0;
  try {
    if (ctx && typeof ctx.rng === "function") {
      s = (Math.floor(ctx.rng() * 0xffffffff) >>> 0) || s;
    }
  } catch (_) {}
  return s >>> 0;
}

function ensureOverlay() {
  if (_overlay) return _overlay;

  const ov = document.createElement("div");
  ov.id = "fishing-overlay";
  ov.style.position = "fixed";
  ov.style.left = "0";
  ov.style.top = "0";
  ov.style.right = "0";
  ov.style.bottom = "0";
  ov.style.background = "rgba(6, 10, 18, 0.78)";
  ov.style.zIndex = "50010";
  ov.style.display = "none";
  ov.style.backdropFilter = "blur(1px)";

  const wrap = document.createElement("div");
  wrap.style.position = "absolute";
  wrap.style.left = "50%";
  wrap.style.top = "50%";
  wrap.style.transform = "translate(-50%, -50%)";
  wrap.style.background = "rgba(15, 18, 28, 0.95)";
  wrap.style.border = "1px solid #2b3854";
  wrap.style.borderRadius = "10px";
  wrap.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
  wrap.style.padding = "12px";

  const title = document.createElement("div");
  title.textContent = "Fishing";
  title.style.color = "#e5e7eb";
  title.style.fontSize = "16px";
  title.style.fontWeight = "600";
  title.style.marginBottom = "8px";

  const hint = document.createElement("div");
  hint.textContent = "Hold Space (or mouse) to raise. Keep marker inside the drifting zone!";
  hint.style.color = "#94a3b8";
  hint.style.fontSize = "12px";
  hint.style.marginBottom = "8px";

  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 220;
  canvas.style.display = "block";
  canvas.style.background = "#0b0f19";
  canvas.style.border = "1px solid #22314e";
  canvas.style.borderRadius = "6px";

  wrap.appendChild(title);
  wrap.appendChild(hint);
  wrap.appendChild(canvas);
  ov.appendChild(wrap);
  document.body.appendChild(ov);

  _overlay = ov;
  _canvas = canvas;
  _ctx2d = canvas.getContext("2d");

  const isRaiseKey = (e) => {
    const k = (e && e.key) ? String(e.key) : "";
    const c = (e && e.code) ? String(e.code) : "";
    const lower = k.toLowerCase();
    return lower === " " || lower === "space" || c === "Space" || k === "Enter";
  };

  // Input handlers
  const onKey = (e) => {
    if (!_running) return;
    try {
      e.preventDefault();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      else e.stopPropagation();
    } catch (_) {}

    if (isRaiseKey(e)) {
      _press = (e.type === "keydown");
      return;
    }

    if (e.key === "Escape" || e.key === "Esc") {
      try { if (typeof _onDone === "function") _onDone(false); } catch (_) {}
      try {
        const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
        if (GM && typeof GM.onEvent === "function") {
          const scope = _gameCtx && _gameCtx.mode ? _gameCtx.mode : "world";
          GM.onEvent(_gameCtx, { type: "mechanic", scope, interesting: false, mechanic: "fishing", action: "dismiss" });
        }
      } catch (_) {}
      hide();
    }
  };

  const onMouse = (e) => {
    if (!_running) return;
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch (_) {}
    if (e.type === "mousedown" || e.type === "touchstart") _press = true;
    if (e.type === "mouseup" || e.type === "mouseleave" || e.type === "touchend" || e.type === "touchcancel") _press = false;
  };

  ov.addEventListener("mousedown", onMouse);
  ov.addEventListener("mouseup", onMouse);
  ov.addEventListener("mouseleave", onMouse);
  ov.addEventListener("touchstart", onMouse, { passive: false });
  ov.addEventListener("touchend", onMouse);
  ov.addEventListener("touchcancel", onMouse);

  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);

  return ov;
}

function resetState(opts, ctx) {
  _marker = 0.5;
  _progress = 0.0;
  _stress = 0.0;

  const baseDifficulty = (opts && typeof opts.difficulty === "number") ? clamp(opts.difficulty, 0, 1) : 0.5;

  // Foraging skill eases fishing slightly
  let foraging = 0;
  try {
    foraging = ((ctx && ctx.player && ctx.player.skills && typeof ctx.player.skills.foraging === "number") ? ctx.player.skills.foraging : 0) | 0;
  } catch (_) {}
  const ease = clamp(foraging * 0.0012, 0, 0.12);
  const effDifficulty = clamp(baseDifficulty - ease, 0, 1);

  // Smaller zone and faster drift scale with difficulty
  _zoneSizeBase = Math.max(0.12, 0.28 - effDifficulty * 0.16);
  _zoneSpeedBase = 0.18 + effDifficulty * 0.24;

  _seedRng = mulberry32(seedFromCtx(ctx));

  _zoneSize = _zoneSizeBase;
  _zoneCenter = 0.5 * (0.8 + _seedRng() * 0.4);

  _pulseT = _seedRng() * 10;
  _dashT = 0;
  _nextDash = 0.8 + _seedRng() * 1.6;
  _dashDir = _seedRng() < 0.5 ? -1 : 1;
  _lastTs = 0;
}

function draw() {
  const g = _ctx2d;
  if (!g || !_canvas) return;
  const w = _canvas.width;
  const h = _canvas.height;
  g.clearRect(0, 0, w, h);

  const meterX = Math.floor(w * 0.6);
  const meterTop = Math.floor(h * 0.12);
  const meterBottom = Math.floor(h * 0.88);
  const meterW = 16;
  const meterH = meterBottom - meterTop;

  // Progress bar (top)
  const progH = 10;
  g.fillStyle = "#1e293b";
  g.fillRect(12, 16, w - 24, progH);
  g.fillStyle = "#86efac";
  g.fillRect(12, 16, Math.floor((w - 24) * clamp(_progress, 0, 1)), progH);
  g.strokeStyle = "#334155";
  g.strokeRect(12.5, 16.5, w - 25, progH);

  // Stress bar (bottom)
  const stressH = 10;
  g.fillStyle = "#1f2937";
  g.fillRect(12, h - 22, w - 24, stressH);
  g.fillStyle = "#f87171";
  g.fillRect(12, h - 22, Math.floor((w - 24) * clamp(_stress, 0, 1)), stressH);
  g.strokeStyle = "#334155";
  g.strokeRect(12.5, h - 21.5, w - 25, stressH);

  // Meter background
  g.fillStyle = "#0e1726";
  g.fillRect(meterX - meterW / 2, meterTop, meterW, meterH);
  g.strokeStyle = "#22314e";
  g.strokeRect(meterX - meterW / 2 + 0.5, meterTop + 0.5, meterW - 1, meterH - 1);

  // Safe zone
  const zonePx = Math.floor(_zoneSize * meterH);
  const zoneTop = Math.floor(meterTop + (1 - _zoneCenter - _zoneSize / 2) * meterH);
  g.fillStyle = "rgba(134, 239, 172, 0.25)";
  g.fillRect(meterX - meterW / 2, zoneTop, meterW, zonePx);
  g.strokeStyle = "rgba(134, 239, 172, 0.6)";
  g.strokeRect(meterX - meterW / 2 + 0.5, zoneTop + 0.5, meterW - 1, zonePx - 1);

  // Marker
  const markerY = Math.floor(meterTop + (1 - _marker) * meterH);
  g.fillStyle = "#60a5fa";
  g.fillRect(meterX - meterW / 2 - 6, markerY - 6, meterW + 12, 12);
  g.strokeStyle = "#93c5fd";
  g.strokeRect(meterX - meterW / 2 - 6 + 0.5, markerY - 6 + 0.5, meterW + 12 - 1, 12 - 1);

  g.fillStyle = "#94a3b8";
  g.font = "12px JetBrains Mono, monospace";
  g.fillText("Progress", 14, 14);
  g.fillText("Line Stress", 14, h - 26);
}

function step(ts, hooks) {
  if (!_running) return;
  if (_lastTs === 0) _lastTs = ts;
  const dt = clamp((ts - _lastTs) / 1000, 0, 0.05);
  _lastTs = ts;

  // Marker physics
  const upSpeed = 0.9;
  const downSpeed = 0.7;
  const vel = _press ? upSpeed : -downSpeed;
  _marker = clamp(_marker + vel * dt, 0, 1);

  // Wilder: size pulsing (±15% around baseline)
  _pulseT += dt * 1.4;
  const pulseFactor = 0.85 + 0.15 * Math.sin(_pulseT);
  _zoneSize = clamp(_zoneSizeBase * pulseFactor, 0.10, 0.35);

  // Wilder: dash scheduling
  if (_dashT > 0) {
    _dashT -= dt;
  } else {
    _nextDash -= dt;
    if (_nextDash <= 0) {
      _dashT = 0.25 + _seedRng() * 0.35;
      _dashDir = _seedRng() < 0.5 ? -1 : 1;
      _nextDash = 0.8 + _seedRng() * 2.0;
    }
  }

  // Zone drift + jitter + dash multiplier
  const dashMul = _dashT > 0 ? (2.8 + _seedRng() * 1.6) : 1.0;
  const jitter = (_seedRng() - 0.5) * 0.45 * _zoneSpeedBase * (1 + 0.3 * _seedRng());
  const dir = _dashT > 0 ? _dashDir : (_seedRng() < 0.5 ? -1 : 1);
  const speedNow = _zoneSpeedBase * dashMul;

  _zoneCenter += (dir * speedNow + jitter) * dt;
  _zoneCenter = clamp(_zoneCenter, _zoneSize / 2, 1 - _zoneSize / 2);

  const zoneLo = _zoneCenter - _zoneSize / 2;
  const zoneHi = _zoneCenter + _zoneSize / 2;
  const inside = _marker >= zoneLo && _marker <= zoneHi;

  // Progress and stress dynamics
  const catchRate = 0.28;
  const stressRate = 0.65;
  const relaxRate = 0.28;

  if (inside) {
    _progress = clamp(_progress + catchRate * dt, 0, 1);
    _stress = clamp(_stress - relaxRate * dt, 0, 1);
  } else {
    _stress = clamp(_stress + stressRate * dt, 0, 1);
  }

  draw();

  if (_progress >= 1.0) {
    try { if (hooks && typeof hooks.onFinish === "function") hooks.onFinish(true); } catch (_) {}
    return;
  }
  if (_stress >= 1.0) {
    try { if (hooks && typeof hooks.onFinish === "function") hooks.onFinish(false); } catch (_) {}
    return;
  }

  _raf = requestAnimationFrame((t) => step(t, hooks));
}

export function show(ctx, opts = {}) {
  ensureOverlay();
  _gameCtx = ctx || null;
  resetState(opts, ctx);

  // GMRuntime: fishing mechanic seen/tried (explicitly not interesting)
  try {
    const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
    if (GM && typeof GM.onEvent === "function") {
      const scope = ctx && ctx.mode ? ctx.mode : "world";
      GM.onEvent(ctx, { type: "mechanic", scope, interesting: false, mechanic: "fishing", action: "seen" });
      GM.onEvent(ctx, { type: "mechanic", scope, interesting: false, mechanic: "fishing", action: "tried" });
    }
  } catch (_) {}

  const minutes = (typeof opts.minutesPerAttempt === "number") ? clamp(opts.minutesPerAttempt | 0, 1, 60) : 15;

  const onFinish = (ok) => {
    _running = false;
    try { cancelAnimationFrame(_raf); } catch (_) {}

    try {
      if (typeof ctx.advanceTimeMinutes === "function") ctx.advanceTimeMinutes(minutes);
      else if (typeof window !== "undefined" && window.GameAPI && typeof window.GameAPI.advanceMinutes === "function") window.GameAPI.advanceMinutes(minutes);
    } catch (_) {}
    try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}

    // GMRuntime: outcome (explicitly not interesting)
    try {
      const GM = (typeof window !== "undefined" ? window.GMRuntime : null);
      if (GM && typeof GM.onEvent === "function") {
        const scope = (ctx && ctx.mode) ? ctx.mode : "world";
        GM.onEvent(ctx, { type: "mechanic", scope, interesting: false, mechanic: "fishing", action: ok ? "success" : "failure" });
      }
    } catch (_) {}

    if (ok) {
      // Small chance to catch an item instead of a fish
      let rngFn = null;
      try {
        if (typeof window !== "undefined" && window.RNGUtils && typeof window.RNGUtils.getRng === "function") {
          rngFn = window.RNGUtils.getRng((typeof ctx.rng === "function") ? ctx.rng : undefined);
        }
      } catch (_) {}
      if (!rngFn) rngFn = (typeof ctx.rng === "function") ? ctx.rng : Math.random;

      const specialChance = (opts && typeof opts.itemChance === "number") ? clamp(opts.itemChance, 0, 1) : 0.01;
      const isSpecial = rngFn() < specialChance;

      try {
        const inv = (ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : (ctx.player.inventory = []);

        if (isSpecial) {
          let awarded = null;
          let isBottleMap = false;

          // GM-driven Bottle Map award logic (pity timer + boredom gating).
          try {
            const GMB = (typeof window !== "undefined" ? window.GMBridge : null);
            if (GMB && typeof GMB.maybeAwardBottleMapFromFishing === "function") {
              isBottleMap = !!GMB.maybeAwardBottleMapFromFishing(ctx);
            }
          } catch (_) {
            isBottleMap = false;
          }

          if (isBottleMap) {
            // GMBridge already inserted the item.
            awarded = null;
          }

          if (!isBottleMap) {
            // Prefer a real equipment item if Items registry is available; fallback to a trinket
            try {
              if (typeof window !== "undefined" && window.Items && typeof window.Items.createEquipment === "function") {
                const tier = (rngFn() < 0.12) ? 2 : 1;
                awarded = window.Items.createEquipment(tier, rngFn) || null;
              }
            } catch (_) {}
            if (!awarded) {
              awarded = { kind: "material", type: "old_boot", name: "old boot", amount: 1 };
            }
          }

          if (awarded) inv.push(awarded);
          try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
          try { if (typeof ctx.rerenderInventoryIfOpen === "function") ctx.rerenderInventoryIfOpen(); } catch (_) {}
          try {
            if (ctx.log) {
              if (!isBottleMap) ctx.log(`You fished up ${awarded.name || "something curious"}!`, "good");
            }
          } catch (_) {}
        } else {
          // Regular fish
          const existing = inv.find((it) => it && it.kind === "material" && String(it.type || it.name || "").toLowerCase() === "fish");
          if (existing) {
            if (typeof existing.amount === "number") existing.amount += 1;
            else if (typeof existing.count === "number") existing.count += 1;
            else existing.amount = 1;
          } else {
            inv.push({ kind: "material", type: "fish", name: "fish", amount: 1 });
          }
          try { if (typeof ctx.updateUI === "function") ctx.updateUI(); } catch (_) {}
          try { if (typeof ctx.rerenderInventoryIfOpen === "function") ctx.rerenderInventoryIfOpen(); } catch (_) {}
          try { if (ctx.log) ctx.log("You caught a fish!", "good"); } catch (_) {}
        }
      } catch (_) {}
    } else {
      try { if (ctx.log) ctx.log("The fish got away.", "warn"); } catch (_) {}
    }

    // Decay the fishing pole on every attempt; break at 100% decay
    try {
      const inv = (ctx.player && Array.isArray(ctx.player.inventory)) ? ctx.player.inventory : null;
      if (inv && inv.length) {
        let poleIdx = -1;
        for (let i = 0; i < inv.length; i++) {
          const it = inv[i];
          if (!it) continue;
          const k = String(it.kind || "").toLowerCase();
          const tp = String(it.type || "").toLowerCase();
          const nm = String(it.name || "").toLowerCase();
          if (k === "tool" && (tp === "fishing_pole" || nm.includes("fishing pole") || nm.includes("fishing_pole"))) { poleIdx = i; break; }
        }
        if (poleIdx !== -1) {
          const pole = inv[poleIdx];

          // Normalize legacy durability -> decay scale if needed
          if (typeof pole.decay !== "number") {
            if (typeof pole.durability === "number") {
              const d = clamp(100 - (pole.durability | 0), 0, 100);
              pole.decay = d;
            } else {
              pole.decay = 0;
            }
          }

          const amt = (opts && typeof opts.decayPerAttempt === "number") ? clamp(opts.decayPerAttempt, 0, 100) : 10;
          const before = pole.decay | 0;
          pole.decay = clamp((pole.decay || 0) + amt, 0, 100);

          if (pole.decay >= 100) {
            inv.splice(poleIdx, 1);
            try { if (ctx.log) ctx.log("Your fishing pole breaks.", "bad"); } catch (_) {}
          } else if (((pole.decay | 0) !== before) && typeof ctx.rerenderInventoryIfOpen === "function") {
            try { ctx.rerenderInventoryIfOpen(); } catch (_) {}
          }
        }
      }
    } catch (_) {}

    hide();
  };

  _onDone = (ok) => onFinish(!!ok);

  _overlay.style.display = "block";
  _running = true;
  _press = false;
  _lastTs = 0;
  draw();
  _raf = requestAnimationFrame((t) => step(t, { onFinish }));
}

export function hide() {
  _running = false;
  try { cancelAnimationFrame(_raf); } catch (_) {}
  if (_overlay) _overlay.style.display = "none";
  _onDone = null;
}

export function isOpen() {
  try { return !!(_overlay && _overlay.style.display !== "none"); } catch (_) { return false; }
}

import { attachGlobal } from "/utils/global.js";
attachGlobal("FishingModal", { show, hide, isOpen });