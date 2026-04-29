/**
 * Access helpers: standardized ctx-first module and data lookups with optional window fallback.
 * Use these to avoid scattering ctx/window checks across modules.
 */

export function getMod(ctx, name) {
  try {
    if (ctx && ctx[name]) return ctx[name];
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window[name]) return window[name];
  } catch (_) {}
  return null;
}

export function getGameData(ctx) {
  try {
    if (ctx && ctx.GameData) return ctx.GameData;
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.GameData) return window.GameData;
  } catch (_) {}
  return null;
}

export function getRNGUtils(ctx) {
  try {
    if (ctx && ctx.RNGUtils) return ctx.RNGUtils;
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.RNGUtils) return window.RNGUtils;
  } catch (_) {}
  return null;
}

export function getUIOrchestration(ctx) {
  try {
    if (ctx && ctx.UIOrchestration) return ctx.UIOrchestration;
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && window.UIOrchestration) return window.UIOrchestration;
  } catch (_) {}
  return null;
}