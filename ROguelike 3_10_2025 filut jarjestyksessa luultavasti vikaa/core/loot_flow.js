/**
 * LootFlow: ctx-first wrappers around loot UI and ground loot actions.
 *
 * Exports (ESM + window.LootFlow):
 * - show(ctx, list)
 * - hide(ctx)
 * - loot(ctx)
 */

function mod(name) {
  try {
    const w = (typeof window !== "undefined") ? window : {};
    return w[name] || null;
  } catch (_) { return null; }
}

function requestDraw(ctx) {
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.requestDraw === "function") {
      UIO.requestDraw(ctx);
      return;
    }
  } catch (_) {}
  try {
    const GL = mod("GameLoop");
    if (GL && typeof GL.requestDraw === "function") {
      GL.requestDraw();
      return;
    }
  } catch (_) {}
}

export function show(ctx, list) {
  const UB = mod("UIBridge");
  let wasOpen = false;
  try { if (UB && typeof UB.isLootOpen === "function") wasOpen = !!UB.isLootOpen(); } catch (_) {}
  if (UB && typeof UB.showLoot === "function") {
    UB.showLoot(ctx, list);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hide(ctx) {
  const UB = mod("UIBridge");
  let wasOpen = true;
  try { if (UB && typeof UB.isLootOpen === "function") wasOpen = !!UB.isLootOpen(); } catch (_) {}
  if (UB && typeof UB.hideLoot === "function") {
    UB.hideLoot(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function loot(ctx) {
  const A = mod("Actions");
  if (A && typeof A.loot === "function") {
    const handled = !!A.loot(ctx);
    if (handled) return true;
  }
  if (ctx.mode === "dungeon") {
    const DR = mod("DungeonRuntime");
    if (DR && typeof DR.lootHere === "function") { DR.lootHere(ctx); return true; }
    const L = mod("Loot");
    if (L && typeof L.lootHere === "function") { L.lootHere(ctx); return true; }
    try { ctx.log && ctx.log("Return to the entrance (the hole '>') and press G to leave.", "info"); } catch (_) {}
    return true;
  }
  try { ctx.log && ctx.log("Nothing to do here."); } catch (_) {}
  return false;
}

import { attachGlobal } from "../utils/global.js";
attachGlobal("LootFlow", { show, hide, loot });