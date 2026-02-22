/**
 * HarborGeneration facade (optional)
 *
 * HealthCheck registers an optional "HarborGeneration" module spec that expects
 * window.Harbor (or ctx.Harbor) to expose:
 *   - prepareHarborZone(ctx, W, H, gate)
 *   - placeHarborPrefabs(ctx, buildings, W, H, gate, plaza, rng, stampPrefab, trySlipStamp)
 *
 * Harbor generation is experimental and only used for port towns. This facade
 * exists purely so boot-time health diagnostics can find the module consistently
 * without requiring callers to import worldgen/town/harbor.js directly.
 *
 * No behavior changes: this module simply re-exports the existing implementation
 * and attaches it to window when available.
 */

import { prepareHarborZone, placeHarborPrefabs } from "../../worldgen/town/harbor.js";
import { attachGlobal } from "../../utils/global.js";

export { prepareHarborZone, placeHarborPrefabs };

// Back-compat + HealthCheck visibility
attachGlobal("Harbor", { prepareHarborZone, placeHarborPrefabs });
