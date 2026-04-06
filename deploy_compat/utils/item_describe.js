/**
 * ItemDescribe: centralized item description for UI/logs.
 *
 * Exports (ESM + window.ItemDescribe):
 * - describe(item)
 */
export function describe(item) {
  if (!item) return "";
  if (item.kind === "equip") {
    const parts = [];
    if ("atk" in item) parts.push(`+${Number(item.atk).toFixed(1)} atk`);
    if ("def" in item) parts.push(`+${Number(item.def).toFixed(1)} def`);
    return `${item.name}${parts.length ? " (" + parts.join(", ") + ")" : ""}`;
  }
  if (item.kind === "potion") {
    const heal = item.heal ?? 3;
    const base = item.name || `potion (+${heal} HP)`;
    const count = item.count && item.count > 1 ? ` x${item.count}` : "";
    return `${base}${count}`;
  }
  if (item.kind === "material") {
    const base = item.name || "material";
    const qty = (typeof item.amount === "number" ? item.amount : (typeof item.count === "number" ? item.count : null));
    const type = item.type || item.material || "";
    const typeStr = type ? ` (${type})` : "";
    return qty != null ? `${base}${typeStr}: ${qty}` : `${base}${typeStr}`;
  }
  return item.name || "item";
}

import { attachGlobal } from "./global.js";
// Back-compat: attach to window via helper
attachGlobal("ItemDescribe", { describe });