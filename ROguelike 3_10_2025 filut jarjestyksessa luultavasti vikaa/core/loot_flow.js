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
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.showLoot === "function") {
      // UIOrchestration handles draw if open-state changes
      UIO.showLoot(ctx, list);
      return;
    }
  } catch (_) {}
}

export function hide(ctx) {
  try {
    const UIO = mod("UIOrchestration");
    if (UIO && typeof UIO.hideLoot === "function") {
      UIO.hideLoot(ctx);
      return;
    }
  } catch (_) {}
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