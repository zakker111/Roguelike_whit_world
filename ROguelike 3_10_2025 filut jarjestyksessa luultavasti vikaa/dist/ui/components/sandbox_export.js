/**
 * Sandbox enemy JSON export helper for the SandboxPanel (Copy JSON button).
 *
 * Exports:
 * - copyEnemyJsonStubToClipboard()
 *
 * This is UI-layer code: it talks to DOM, GameData, and GameAPI directly.
 * Behavior is kept identical to the previous inline implementation in
 * sandbox_panel.js.
 */

import { currentEnemyId } from "/ui/components/sandbox_spawn.js";

function byId(id) {
  try { return document.getElementById(id); } catch (_) { return null; }
}

function getCtxSafe() {
  try {
    if (!window.GameAPI || typeof window.GameAPI.getCtx !== "function") return null;
    return window.GameAPI.getCtx() || null;
  } catch (_) {
    return null;
  }
}

export function copyEnemyJsonStubToClipboard() {
  try {
    const enemyId = currentEnemyId();
    if (!enemyId) {
      if (window.GameAPI && typeof window.GameAPI.log === "function") {
        window.GameAPI.log("Sandbox: Enemy id is empty; cannot build JSON stub.", "warn");
      }
      return;
    }

    // Base JSON from GameData.enemies when available
    let baseRow = null;
    try {
      const GD = (typeof window !== "undefined" ? window.GameData : null);
      const list = GD && Array.isArray(GD.enemies) ? GD.enemies : null;
      if (list) {
        const keyLower = String(enemyId).toLowerCase();
        for (let i = 0; i < list.length; i++) {
          const row = list[i];
          if (!row) continue;
          const idRaw = row.id || row.key || row.type;
          if (idRaw && String(idRaw).toLowerCase() === keyLower) {
            baseRow = row;
            break;
          }
        }
      }
    } catch (_) {
      baseRow = null;
    }

    // Read current sandbox fields with fallbacks to baseRow when reasonable
    const glyphInput = byId("sandbox-glyph");
    const colorInput = byId("sandbox-color");
    const factionInput = byId("sandbox-faction");
    const hpInput = byId("sandbox-hp");
    const atkInput = byId("sandbox-atk");
    const xpInput = byId("sandbox-xp");
    const dmgInput = byId("sandbox-damage-scale");
    const eqInput = byId("sandbox-equip-chance");
    const depthInput2 = byId("sandbox-test-depth");

    const glyphVal = glyphInput && glyphInput.value
      ? String(glyphInput.value)
      : (baseRow && baseRow.glyph ? String(baseRow.glyph) : "?");

    const colorVal = colorInput && colorInput.value
      ? String(colorInput.value)
      : (baseRow && baseRow.color ? String(baseRow.color) : "#cbd5e1");

    const factionVal = factionInput && factionInput.value
      ? String(factionInput.value)
      : (baseRow && baseRow.faction ? String(baseRow.faction) : "monster");

    const depth = depthInput2 ? (((Number(depthInput2.value) || 0) | 0) || 1) : 1;
    const hpVal = hpInput && hpInput.value !== "" ? (Number(hpInput.value) || 1) : 1;
    const atkVal = atkInput && atkInput.value !== "" ? (Number(atkInput.value) || 1) : 1;
    const xpVal = xpInput && xpInput.value !== "" ? (Number(xpInput.value) || 1) : 1;

    const dmgScaleVal = dmgInput && dmgInput.value !== ""
      ? (Number(dmgInput.value) || 1)
      : (baseRow && typeof baseRow.damageScale === "number" ? baseRow.damageScale : 1.0);

    const equipChanceVal = eqInput && eqInput.value !== ""
      ? (Number(eqInput.value) || 0)
      : (baseRow && typeof baseRow.equipChance === "number" ? baseRow.equipChance : 0.35);

    let tierVal = baseRow && typeof baseRow.tier === "number" ? baseRow.tier : 1;
    // Prefer sandbox loot tier override when present for this enemy.
    try {
      const ctx0 = getCtxSafe();
      if (ctx0 && ctx0.sandboxEnemyOverrides && typeof ctx0.sandboxEnemyOverrides === "object") {
        const ov0 = ctx0.sandboxEnemyOverrides[enemyId] || ctx0.sandboxEnemyOverrides[String(enemyId).toLowerCase()] || null;
        if (ov0 && typeof ov0.equipTierOverride === "number") {
          const t0 = (ov0.equipTierOverride | 0);
          if (t0 >= 1 && t0 <= 3) {
            tierVal = t0;
          }
        }
      }
    } catch (_) {}
    const blockBaseVal = baseRow && typeof baseRow.blockBase === "number" ? baseRow.blockBase : 0.06;

    let weightByDepthVal = null;
    if (baseRow && baseRow.weightByDepth && Array.isArray(baseRow.weightByDepth) && baseRow.weightByDepth.length > 0) {
      weightByDepthVal = baseRow.weightByDepth;
    } else {
      weightByDepthVal = [[0, 1.0]];
    }

    let lootPoolsVal = null;
    // Prefer sandbox loot pool overrides when present for this enemy.
    try {
      const ctx = getCtxSafe();
      if (ctx && ctx.sandboxEnemyOverrides && typeof ctx.sandboxEnemyOverrides === "object") {
        const ov = ctx.sandboxEnemyOverrides[enemyId] || null;
        if (ov && ov.lootPools && typeof ov.lootPools === "object") {
          lootPoolsVal = ov.lootPools;
        }
      }
    } catch (_) {}
    if (!lootPoolsVal && baseRow && baseRow.lootPools && typeof baseRow.lootPools === "object") {
      lootPoolsVal = baseRow.lootPools;
    }

    // Helper to build a richer curve by scaling an existing hp/atk/xp curve so that
    // its value at the chosen depth matches the sandbox value. If no base curve
    // exists, fall back to a single-entry flat curve.
    function makeScaledCurve(baseArr, valAtDepth, d) {
      if (!Array.isArray(baseArr) || baseArr.length === 0) {
        return [[d, valAtDepth, 0]];
      }
      const fallback = valAtDepth || 1;
      let chosen = baseArr[0];
      for (let i = 0; i < baseArr.length; i++) {
        const e = baseArr[i];
        if (!e) continue;
        const minD = (e[0] | 0);
        if (minD <= d) chosen = e;
      }
      const minD = chosen[0] | 0;
      const baseV = Number(chosen[1] || fallback);
      const slope = Number(chosen[2] || 0);
      const delta = Math.max(0, d - minD);
      const sample = Math.max(1, Math.floor(baseV + slope * delta));
      if (!sample || sample <= 0 || !valAtDepth || valAtDepth <= 0) {
        return baseArr;
      }
      const r = valAtDepth / sample;
      const out = [];
      for (let i = 0; i < baseArr.length; i++) {
        const e = baseArr[i];
        if (!Array.isArray(e) || e.length < 2) continue;
        const bMin = e[0] | 0;
        const bBase = Number(e[1] || 0);
        const bSlope = Number(e[2] || 0);
        out.push([
          bMin,
          bBase * r,
          bSlope * r
        ]);
      }
      return out.length ? out : baseArr;
    }

    const baseHpArr  = baseRow && Array.isArray(baseRow.hp)  ? baseRow.hp  : null;
    const baseAtkArr = baseRow && Array.isArray(baseRow.atk) ? baseRow.atk : null;
    const baseXpArr  = baseRow && Array.isArray(baseRow.xp)  ? baseRow.xp  : null;

    const hpCurve  = makeScaledCurve(baseHpArr,  hpVal,  depth);
    const atkCurve = makeScaledCurve(baseAtkArr, atkVal, depth);
    const xpCurve  = makeScaledCurve(baseXpArr,  xpVal,  depth);

    const stub = {
      id: enemyId,
      glyph: glyphVal,
      color: colorVal,
      tier: tierVal,
      blockBase: blockBaseVal,
      faction: factionVal,
      hp: hpCurve,
      atk: atkCurve,
      xp: xpCurve,
      weightByDepth: weightByDepthVal,
      equipChance: equipChanceVal,
      damageScale: dmgScaleVal
    };
    if (lootPoolsVal) stub.lootPools = lootPoolsVal;

    const json = JSON.stringify(stub, null, 2);

    function fallbackCopy() {
      try {
        const ta = document.createElement("textarea");
        ta.value = json;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
          ok = document.execCommand("copy");
        } catch (_) {
          ok = false;
        }
        document.body.removeChild(ta);
        return ok;
      } catch (_) {
        return false;
      }
    }

    let usedAsync = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        usedAsync = true;
        navigator.clipboard.writeText(json).then(() => {
          try {
            if (window.GameAPI && typeof window.GameAPI.log === "function") {
              window.GameAPI.log(`Sandbox: Copied enemy JSON stub for '${enemyId}' to clipboard.`, "notice");
            }
          } catch (_) {}
        }).catch(() => {
          const ok = fallbackCopy();
          if (window.GameAPI && typeof window.GameAPI.log === "function") {
            window.GameAPI.log(
              ok
                ? `Sandbox: Copied enemy JSON stub for '${enemyId}' to clipboard. (fallback)`
                : `Sandbox: Failed to copy JSON stub for '${enemyId}' to clipboard.`,
              ok ? "notice" : "warn"
            );
          }
        });
      }
    } catch (_) {
      usedAsync = false;
    }

    if (!usedAsync) {
      const ok = fallbackCopy();
      if (window.GameAPI && typeof window.GameAPI.log === "function") {
        window.GameAPI.log(
          ok
            ? `Sandbox: Copied enemy JSON stub for '${enemyId}' to clipboard. (fallback)`
            : `Sandbox: Failed to copy JSON stub for '${enemyId}' to clipboard.`,
          ok ? "notice" : "warn"
        );
      }
    }
  } catch (e) {
    try {
      if (window.GameAPI && typeof window.GameAPI.log === "function") {
        window.GameAPI.log(`Sandbox: Error while building JSON stub: ${e && e.message ? e.message : e}`, "warn");
      }
    } catch (_) {}
  }
}
