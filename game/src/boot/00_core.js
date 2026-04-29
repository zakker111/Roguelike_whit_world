// Boot slice 00: core globals + boot monitors. Keep order stable.

import '/core/ctx.js';
import '/core/rng_service.js';
import '/core/state/state_sync.js';
import '/core/engine/boot_monitor.js';

// Core fallbacks: HealthCheck expects window.Fallbacks to exist (fallback combat/stat formulas).
import '/core/fallbacks.js';

// Optional: Harbor generation (experimental). Imported early so HealthCheck can
// detect window.Harbor when the harbor worldgen modules are present.
import '/core/facades/harbor_generation.js';
