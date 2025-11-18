/**
 * GameConfig: central accessors for config-driven constants.
 */
export function getRawConfig() {
  try {
    if (typeof window !== "undefined" && window.GameData && window.GameData.config && typeof window.GameData.config === "object") {
      return window.GameData.config;
    }
  } catch (_) {}
  return null;
}

export function getViewportDefaults(cfg) {
  const TILE = (cfg && cfg.viewport && typeof cfg.viewport.TILE === "number") ? cfg.viewport.TILE : 32;
  const COLS = (cfg && cfg.viewport && typeof cfg.viewport.COLS === "number") ? cfg.viewport.COLS : 30;
  const ROWS = (cfg && cfg.viewport && typeof cfg.viewport.ROWS === "number") ? cfg.viewport.ROWS : 20;
  return { TILE, COLS, ROWS };
}

export function getWorldDefaults(cfg) {
  const MAP_COLS = (cfg && cfg.world && typeof cfg.world.MAP_COLS === "number") ? cfg.world.MAP_COLS : 120;
  const MAP_ROWS = (cfg && cfg.world && typeof cfg.world.MAP_ROWS === "number") ? cfg.world.MAP_ROWS : 80;
  return { MAP_COLS, MAP_ROWS };
}

export function getFovDefaults(cfg) {
  const FOV_DEFAULT = (cfg && cfg.fov && typeof cfg.fov.default === "number") ? cfg.fov.default : 8;
  const FOV_MIN = (cfg && cfg.fov && typeof cfg.fov.min === "number") ? cfg.fov.min : 3;
  const FOV_MAX = (cfg && cfg.fov && typeof cfg.fov.max === "number") ? cfg.fov.max : 14;
  return { FOV_DEFAULT, FOV_MIN, FOV_MAX };
}

export function getDevDefaults(cfg) {
  const alwaysCritDefault = (cfg && cfg.dev && typeof cfg.dev.alwaysCritDefault === "boolean") ? !!cfg.dev.alwaysCritDefault : false;
  const critPartDefault = (cfg && cfg.dev && typeof cfg.dev.critPartDefault === "string") ? cfg.dev.critPartDefault : "";
  return { alwaysCritDefault, critPartDefault };
}

// Optional back-compat/debug
if (typeof window !== "undefined") {
  window.GameConfig = {
    getRawConfig,
    getViewportDefaults,
    getWorldDefaults,
    getFovDefaults,
    getDevDefaults
  };
}