export function key(code) {
  try {
    if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom && typeof window.SmokeTest.Helpers.Dom.key === "function") {
      return window.SmokeTest.Helpers.Dom.key(code);
    }
    const ev = new KeyboardEvent("keydown", { key: code, code, bubbles: true });
    try { window.dispatchEvent(ev); } catch (_) {}
    try { document.dispatchEvent(ev); } catch (_) {}
    return true;
  } catch (_) { return false; }
}

export function sleep(ms) {
  try {
    if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom && typeof window.SmokeTest.Helpers.Dom.sleep === "function") {
      return window.SmokeTest.Helpers.Dom.sleep(ms);
    }
  } catch (_) {}
  return new Promise(r => setTimeout(r, Math.max(0, ms | 0)));
}

export function makeBudget(ms) {
  try {
    if (window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Budget && typeof window.SmokeTest.Helpers.Budget.makeBudget === "function") {
      return window.SmokeTest.Helpers.Budget.makeBudget(ms);
    }
  } catch (_) {}
  const start = Date.now();
  const dl = start + Math.max(0, ms | 0);
  return { exceeded: () => Date.now() > dl, remain: () => Math.max(0, dl - Date.now()) };
}

export function withTimeout(work, timeoutMs, label) {
  const ms = Math.max(1, timeoutMs | 0);
  let timer = null;

  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const err = new Error((label || "Operation") + " timed out after " + ms + "ms");
      err.code = "SMOKE_TIMEOUT";
      reject(err);
    }, ms);

    Promise.resolve()
      .then(() => work())
      .then(
        (value) => {
          try { clearTimeout(timer); } catch (_) {}
          resolve(value);
        },
        (err) => {
          try { clearTimeout(timer); } catch (_) {}
          reject(err);
        }
      );
  });
}

export async function ensureAllModalsClosed(times) {
  try {
    const n = Math.max(1, times | 0);
    for (let i = 0; i < n; i++) {
      key("Escape");
      await sleep(80);
      try {
        const UIO = window.UIOrchestration;
        if (UIO && typeof UIO.hideLoot === "function") UIO.hideLoot({});
        if (UIO && typeof UIO.hideInventory === "function") UIO.hideInventory({});
        if (UIO && typeof UIO.hideGod === "function") UIO.hideGod({});
        if (UIO && typeof UIO.hideShop === "function") UIO.hideShop({});
        if (UIO && typeof UIO.hideSmoke === "function") UIO.hideSmoke({});
        if (UIO && typeof UIO.cancelConfirm === "function") UIO.cancelConfirm({});
      } catch (_) {}
    }
  } catch (_) {}
}

export function openGodPanel() {
  try {
    const UIO = window.UIOrchestration;
    if (UIO && typeof UIO.showGod === "function") {
      UIO.showGod({});
      return true;
    }
  } catch (_) {}
  try {
    const btn = document.getElementById("god-open-btn");
    if (btn) {
      btn.click();
      return true;
    }
  } catch (_) {}
  return false;
}

export async function waitUntilTrue(fn, timeoutMs, intervalMs) {
  try {
    var D = window.SmokeTest && window.SmokeTest.Helpers && window.SmokeTest.Helpers.Dom;
    if (D && typeof D.waitUntilTrue === "function") {
      return await D.waitUntilTrue(fn, timeoutMs, intervalMs);
    }
  } catch (_) {}
  var deadline = Date.now() + Math.max(0, (timeoutMs | 0) || 0);
  var interval = Math.max(1, (intervalMs | 0) || 50);
  while (Date.now() < deadline) {
    try { if (fn()) return true; } catch (_) {}
    await sleep(interval);
  }
  try { return !!fn(); } catch (_) { return false; }
}

function isGameReady() {
  try {
    var G = window.GameAPI || {};
    if (typeof G.getMode === "function") {
      var m = G.getMode();
      if (m === "world" || m === "dungeon" || m === "town") return true;
    }
    // Fallback: player exists with coordinates
    if (typeof G.getPlayer === "function") {
      var p = G.getPlayer();
      if (p && typeof p.x === "number" && typeof p.y === "number") return true;
    }
  } catch (_) {}
  return false;
}

export async function waitUntilGameReady(timeoutMs) {
  return await waitUntilTrue(() => isGameReady(), Math.max(500, timeoutMs | 0), 80);
}

export async function waitUntilScenariosReady(timeoutMs) {
  const ok = await waitUntilTrue(() => {
    try {
      const S = window.SmokeTest && window.SmokeTest.Scenarios;
      if (!S) return false;
      // Require at least a couple of core scenarios to be present
      const hasAny =
        (S.World && typeof S.World.run === "function") ||
        (S.Dungeon && typeof S.Dungeon.run === "function") ||
        (S.Inventory && typeof S.Inventory.run === "function") ||
        (S.Combat && typeof S.Combat.run === "function");
      return !!hasAny;
    } catch (_) { return false; }
  }, Math.max(600, timeoutMs | 0), 60);
  return ok;
}

function isRunnerReady() {
  try {
    const G = window.GameAPI || {};
    // Mode or player coordinate availability
    let modeOK = false;
    try {
      if (typeof G.getMode === "function") {
        const m = G.getMode();
        modeOK = (m === "world" || m === "dungeon" || m === "town");
      }
    } catch (_) {}
    let playerOK = false;
    try {
      if (typeof G.getPlayer === "function") {
        const p = G.getPlayer();
        playerOK = !!(p && typeof p.x === "number" && typeof p.y === "number");
      }
    } catch (_) {}
    const baseOK = (modeOK || playerOK);

    // Scenarios present (same as waitUntilScenariosReady)
    const scenariosOK = (() => {
      try {
        const S = window.SmokeTest && window.SmokeTest.Scenarios;
        if (!S) return false;
        return !!(
          (S.World && typeof S.World.run === "function") ||
          (S.Dungeon && typeof S.Dungeon.run === "function") ||
          (S.Inventory && typeof S.Inventory.run === "function") ||
          (S.Combat && typeof S.Combat.run === "function")
        );
      } catch (_) { return false; }
    })();

    // UI baseline: able to close GOD or at least find the open button
    const uiOK = (() => {
      try {
        if (window.UIOrchestration && typeof window.UIOrchestration.hideGod === "function") return true;
        const gob = document.getElementById("god-open-btn");
        return !!gob;
      } catch (_) { return false; }
    })();

    // Canvas present
    const canvasOK = (() => {
      try { return !!document.getElementById("game"); } catch (_) { return false; }
    })();

    return baseOK && scenariosOK && uiOK && canvasOK;
  } catch (_) { return false; }
}

export async function waitUntilRunnerReady(timeoutMs) {
  const to = Math.max(600, timeoutMs | 0);
  return await waitUntilTrue(() => isRunnerReady(), to, 80);
}

export async function waitUntilGameDataReady(timeoutMs) {
  try {
    const GD = (typeof window !== "undefined") ? window.GameData : null;
    if (!GD || !GD.ready || typeof GD.ready.then !== "function") return true;

    let settled = false;
    try {
      GD.ready.then(
        () => { settled = true; },
        () => { settled = true; }
      );
    } catch (_) {
      settled = true;
    }

    const ok = await waitUntilTrue(() => settled, Math.max(250, timeoutMs | 0), 80);
    return !!ok;
  } catch (_) {
    return true;
  }
}

export async function settleFrames(count) {
  const n = Math.max(1, count | 0);
  for (let i = 0; i < n; i++) {
    await new Promise(r => {
      let done = false;
      const finish = () => { if (!done) { done = true; r(); } };
      const t = setTimeout(finish, 50);
      try {
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            try { clearTimeout(t); } catch (_) {}
            finish();
          });
        }
      } catch (_) {}
    });
  }
}

export async function waitForModeStable(targetMode, timeoutMs) {
  try {
    const G = window.GameAPI || {};
    const ok = await waitUntilTrue(() => {
      try {
        if (typeof G.getMode === "function" && G.getMode() !== targetMode) return false;
        if (typeof G.getPlayer === "function") {
          const p = G.getPlayer();
          if (!p || typeof p.x !== "number" || typeof p.y !== "number") return false;
        }
        if (targetMode === "world" && typeof G.getWorld === "function") {
          const w = G.getWorld();
          if (!w || !Array.isArray(w.map) || !w.map.length) return false;
        }
        if (targetMode !== "world" && typeof G.getCtx === "function") {
          const ctx = G.getCtx();
          const map = (ctx && typeof ctx.getMap === "function") ? ctx.getMap() : (ctx ? ctx.map : null);
          if (!Array.isArray(map) || !map.length) return false;
        }
        return true;
      } catch (_) {
        return false;
      }
    }, Math.max(250, timeoutMs | 0), 80);
    if (ok) await settleFrames(2);
    return !!ok;
  } catch (_) {
    return false;
  }
}
