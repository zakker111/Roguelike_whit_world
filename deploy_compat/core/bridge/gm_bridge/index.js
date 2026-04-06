import { attachGlobal } from "../../../utils/global.js";

import { maybeHandleWorldStep } from "./world_step.js";
import { handleMarkerAction } from "./markers.js";
import { onEncounterComplete } from "./encounters.js";
import { useInventoryItem } from "./inventory.js";
import { maybeAwardBottleMapFromFishing, reconcileMarkers } from "./bottle_map.js";
import { onWorldScanRect, onWorldScanTile, ensureGuaranteedSurveyCache } from "./world_scan.js";

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
};

attachGlobal("GMBridge", {
  maybeHandleWorldStep,
  handleMarkerAction,
  onEncounterComplete,
  useInventoryItem,
  maybeAwardBottleMapFromFishing,
  onWorldScanRect,
  onWorldScanTile,
  ensureGuaranteedSurveyCache,
  reconcileMarkers,
});
