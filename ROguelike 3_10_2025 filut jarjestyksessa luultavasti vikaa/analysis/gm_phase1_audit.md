# GM v0.3 — Phase 1 Audit (Events, Interventions, Reset Semantics)

Scope: **Read-only audit** to support the agreed GM v0.3 contract:
- **Pacing:** rare (only when bored; deterministic random cooldown)
- **Authority:** choices (player-facing confirm/choice prompts; avoid forced outcomes)
- **Persistence:** reset on **Apply Seed**, **Start New Game**, **Death restart**

This file captures what the repo does **today**, what conflicts with the contract (especially boredom resets), and what Phase 2–4 should change.

---

## 0) Key mechanic: how boredom is currently driven

In `core/gm/runtime.js:onEvent(ctx, event)`:
- `const interesting = event.interesting !== false;`  
  → **default is `interesting:true` unless explicitly set to `false`**
- If `interesting` is true:
  - `gm.boredom.turnsSinceLastInterestingEvent = 0;`
  - `gm.boredom.lastInterestingEvent = { type, scope, turn }`

Boredom level is then computed in `core/gm/runtime/tick.js` from `turnsSinceLastInterestingEvent` (normalized with `MAX_TURNS_BORED = 200` and smoothed via `BOREDOM_SMOOTHING_ALPHA`).

**Implication:** any high-frequency event emitter that omits `interesting:false` will hard-reset boredom constantly, preventing “rare when bored” from ever arming.

---

## 1) GM event emissions inventory (non-test gameplay code)

This table is derived from a repo-wide scan of `GM.onEvent(ctx, …)` plus the central `gmEvent(ctx, event)` wrapper in `core/modes/modes.js`.

Legend:
- **interesting:**
  - `explicit false` → does NOT reset boredom
  - `explicit true` or `omitted` → resets boredom (because omitted defaults to true)
- **frequency:** qualitative estimate for “per run” frequency

| event.type | emitter (file:function) | interesting | frequency | note |
|---|---|---:|---:|---|
| `combat.kill` | `core/dungeon/kill_enemy.js:killEnemy` | **omitted** | **high** | emitted per enemy death (major boredom-reset risk) |
| `quest.complete` | `services/quest_service.js:claim` | omitted | low-med | quest turn-ins are occasional; this is a milestone candidate |
| `mechanic` (fishing) | `ui/components/fishing_modal.js` | omitted | med-high | can be repeated many times |
| `mechanic` (quest board open/close) | `ui/quest_board.js` | omitted | med-high | UI toggles can be spammed |
| `mechanic` (quest accept / claim failure) | `services/quest_service.js:accept`, `:claim` | omitted | med | emits tried + success/failure pairs |
| `mechanic` (lockpicking) | `ui/components/lockpick_modal.js` | omitted | med | repeated attempts possible |
| `mechanic` (followers inspect) | `ui/components/follower_modal.js` | omitted | med | inspect modal toggles |
| `mechanic` (followers hire/dismiss) | `core/followers_runtime.js` | omitted | low | occasional |
| `gm.guardFine.pay` / `.refuse` | `core/bridge/gm_bridge.js:handleGuardFineTravelEvent` | omitted | low (unknown) | depends on travel schedule |
| `gm.bottleMap.activated` | `core/bridge/gm_bridge.js:useInventoryItem` | explicit true | low | rare item |
| `gm.bottleMap.encounterStart/Exit` | `core/bridge/gm_bridge.js` | explicit false | low | non-boredom-reset telemetry |
| `gm.bottleMap.claimed` | `core/bridge/gm_bridge.js` | explicit true | low | milestone |
| `gm.surveyCache.encounterStart/Exit` | `core/bridge/gm_bridge.js` | explicit false | low | non-boredom-reset telemetry |
| `gm.surveyCache.claimed` | `core/bridge/gm_bridge.js` | explicit true | low | milestone |
| `mode.enter/leave`, `encounter.enter/exit` | `core/modes/modes.js:gmEvent` (various transitions) | usually explicit true | med | depends on play pattern; Region Map can be spammy |

---

## 2) Top boredom-reset risks (what blocks “rare when bored”)

### Highest impact
1) `combat.kill` (emitted for every kill; defaults to interesting=true)
2) `mechanic:*` telemetry events in UI (fishing, quest board open/close, etc.) default to interesting=true
3) Region Map open/close emits `mode.enter/leave` with `interesting:true` (if players toggle it frequently)

### Why this is a problem for v0.3
v0.3 requires boredom to actually accumulate so that rare interventions can trigger when the player is bored.

If kills and UI telemetry hard-reset boredom, then boredom becomes “almost always low” during normal play.

---

## 3) GM interventions inventory (choice prompts vs non-interventions)

### Interventions (should spend the v0.3 cooldown budget)
Per the v0.3 definition: **only player-facing choice prompts** count.

- **Guard fine confirm**
  - `core/bridge/gm_bridge.js:handleGuardFineTravelEvent` → `UIOrchestration.showConfirm(...)`
  - **Counts as intervention:** YES
  - **No forced-outcome fallback:** if confirm UI is missing, the event is skipped (no auto-pay / auto-refuse).

### Non-interventions (should NOT spend budget)
- **Entrance flavor logs**
  - `core/modes/modes.js:gmEvent` + `core/gm/runtime/intents/entrance.js`
  - **Counts as intervention:** NO

- **Mechanic hint logs**
  - `core/modes/modes.js:gmEvent` + `core/gm/runtime/intents/mechanic_hint.js`
  - **Counts as intervention:** NO

### Marker threads (currently NOT choice prompts, but should become choices for v0.3)
- Survey Cache marker (`gm.surveyCache`) and Bottle Map marker (`gm.bottleMap`) currently:
  - Pressing `G` triggers encounter entry directly (no confirm)
  - This violates the spirit of **authority=choices** (even if it’s “positive content”)

**Phase 4 implication:** convert marker activation into a confirm prompt:
- `G` on marker → confirm “Investigate?” → enter encounter only if yes
- This also gives a clean place to “spend intervention budget”.

---

## 4) GM-driven mode transitions (ctx-first status)

From current audit:
- **Marker-triggered encounter starts are ctx-first**
  - Path: `core/modes/actions.js` → `GMBridge.handleMarkerAction(ctx)` → `startGmFactionEncounter(... { ctxFirst:true })`

- **Travel-event encounter starts**
  - Path: `core/world/move.js` → `GMBridge.maybeHandleWorldStep(ctx)` → `startGmFactionEncounter(ctx, encId)`
  - **Status:** updated during Phase 2 work so `startGmFactionEncounter` is **ctx-first by default** (opts can still explicitly set `ctxFirst:false` for legacy behavior).

**Phase 2 action (now in-progress):** ensure all GM-driven encounter starts remain ctx-first and remove any remaining ctx-reacquire paths where they can desync movement/transition commits.

---

## 5) Reset semantics (Apply Seed / New Game / Death restart)

### Where GM is persisted
- `core/gm/runtime.js` owns persistence of `GM_STATE_V1` (read/write/clear)
- It is also cleared by general wipe helpers:
  - `core/state/persistence.js:clearPersistentGameStorage` removes `GM_STATE_V1`
  - `data/god.js` clear routines remove `GM_STATE_V1`
  - `index.html` deploy/version invalidation removes `GM_STATE_V1`

### Contract match
- **Apply Seed:** resets GM via `GMRuntime.reset(...)` (clears persisted + in-memory)
- **Start New Game:** resets GM (via restart flow) and clears persisted state
- **Death restart:** resets GM (via `core/death_flow.js:restart` calling `GMRuntime.reset`)

### Smoketest coverage
- Scenario file exists: `smoketest/scenarios/gm_seed_reset.js`.
- `smoketest/scenarios.json` **does list** `gm_seed_reset` (and `gm_boredom_interest`).

---

## 6) Phase 3 recommendation (make boredom “partial recovery”, not hard reset)

v0.3 requires: “boredom can reset a bit when doing stuff but should not always go to 0”.

Recommended approach for Phase 3 (design-level; no code in this phase 1 report):

1) **Emitter hygiene first (reduce spam):**
   - Mark high-frequency telemetry events as `interesting:false` by default.
   - Candidates:
     - `combat.kill` (except possibly bosses)
     - all `type:"mechanic"` telemetry events
     - Region Map open/close events (if that toggling is frequent)

2) **Replace hard reset with partial recovery:**
   - Add an interest tier or delta to events, e.g.:
     - `event.interest = "none" | "minor" | "major"`
     - or `event.interestDeltaTurns = N`
   - Apply:
     - minor events: subtract some turns from `turnsSinceLastInterestingEvent`
     - major events: subtract a lot (or near-reset)

3) **Define “major milestones” explicitly:**
   - likely majors:
     - `quest.complete`
     - `encounter.exit` with victory (and/or `gm.*.claimed`)
     - major discoveries (optional)

---

## 7) QA notes (what we verified in Phase 1)

This phase is an audit; it intentionally does not change gameplay.

Evidence-based checks performed:
- Repo-wide scan of `GM.onEvent(ctx, …)` emitters
- Read of `core/gm/runtime.js:onEvent` boredom behavior
- Read of `core/gm/runtime/tick.js` boredom normalization
- Verified GM scenario manifest at `smoketest/scenarios.json` (it lists GM scenarios including `gm_seed_reset` and `gm_boredom_interest`)

### Runtime smoketests (not executed here)
This environment does not provide a terminal runner in the current toolset, so smoketests were not executed from here.

Recommended manual verification command/URL (per `smoketest.md`):
- Open: `index.html?smoketest=1&dev=1&scenarios=gm_seed_reset,gm_boredom_interest,gm_bridge_faction_travel,gm_bridge_markers,gm_bottle_map,gm_survey_cache`

---

## 8) Next steps (Phase plan pointer)

- **Phase 2:** ctx-first hardening for travel-event encounter starts + choice-only guard rails.
- **Phase 3:** event-interest weighting + partial boredom recovery + emitter hygiene.
- **Phase 4:** implement rare pacing: bored-gated + deterministic random cooldown (400–600 turns) spending budget only on choice prompts.
