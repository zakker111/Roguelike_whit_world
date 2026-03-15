// Stable GMBridge entry-point.
//
// Keep existing call sites importing `core/bridge/gm_bridge.js` working while
// the implementation lives in `core/bridge/gm_bridge/`.

export {
  maybeHandleWorldStep,
  handleMarkerAction,
  onEncounterComplete,
  useInventoryItem,
  maybeAwardBottleMapFromFishing,
  onWorldScanRect,
  onWorldScanTile,
  ensureGuaranteedSurveyCache,
  reconcileMarkers,
} from "./gm_bridge/index.js";
