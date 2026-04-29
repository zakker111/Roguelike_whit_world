/**
 * PropPalette: palette-driven fallback colors for common props.
 * Exports (ESM + window.PropPalette):
 * - propColor(type, defaultColor)
 */
export function propColor(type, defaultColor) {
  try {
    const pal = (typeof window !== "undefined" && window.GameData && window.GameData.palette && window.GameData.palette.overlays)
      ? window.GameData.palette.overlays
      : null;
    if (!pal) return defaultColor;
    const t = String(type || "").toLowerCase();
    // Specific keys first, then category fallbacks
    const SPEC = {
      crate: ["propCrate", "propWood"],
      barrel: ["propBarrel", "propWood"],
      chest: ["propChest", "propWood"],
      shelf: ["propShelf", "propWood"],
      bench: ["propBench", "propWood"],
      table: ["propTable", "propWood"],
      chair: ["propChair", "propWood"],
      counter: ["propCounter", "propWood"],
      rug: ["propRug", "propFabric"],
      plant: ["propPlant", "propGreen"],
      lamp: ["propLamp", "propLight"],
      fireplace: ["propFire", "propLight"],
      sign: ["propSign", "propWood"],
      well: ["propWell", "propStone"],
      stall: ["propStall", "propFabric"]
    };
    const keys = SPEC[t] || [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = pal[k];
      if (typeof v === "string" && v.trim().length) return v;
    }
    return defaultColor;
  } catch (_) {
    return defaultColor;
  }
}

import { attachGlobal } from "../utils/global.js";
attachGlobal("PropPalette", { propColor });