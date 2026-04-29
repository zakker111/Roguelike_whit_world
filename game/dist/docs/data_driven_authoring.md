# Data-Driven Authoring Guide

This repo is meant to grow by adding or adjusting data first, then only adding code when a system needs a new rule.

Use this guide when you want to add new gameplay under the current skeleton without digging through the whole runtime.

## Core rule

Prefer this order:

1. add or change JSON data
2. reuse an existing service/runtime hook
3. add a small new service/helper only if the data cannot already be consumed
4. add smoke coverage for the new behavior

Avoid adding one-off hardcoded behavior directly in large runtime files unless the system truly has no data seam yet.

## Fast map of the repo

- `data/`
  - JSON registries and authoring assets
- `services/`
  - shared logic that reads data and exposes stable helpers
- `core/`
  - runtime orchestration, modes, persistence, and cross-system flows
- `ui/`
  - panels, HUD, and player-facing controls
- `smoketest/`
  - scenario coverage and runner infrastructure
- `docs/`
  - architecture notes, slice plans, and extension guidance

## Best extension points by content type

### Items and equipment

Primary files:

- `data/entities/items.json`
- `entities/items.js`
- `entities/loot.js`

Use when:

- adding a normal weapon, armor piece, tool, or equipment variant
- tuning values like price, tier, decay, tags, and names

Prefer data changes first. Code changes are only needed when the item has a new behavior that existing tags/fields cannot express.

### Enemies

Primary files:

- `data/entities/enemies.json`
- `services/encounter_service.js`
- encounter template data under `data/encounters/`

Use when:

- adding a new standard enemy type
- tuning combat stats and spawn pools
- placing enemies into encounter templates

If a new enemy only differs by numbers, tags, or loot, keep it in JSON.

### NPC flavor and town residents

Primary files:

- `data/entities/npcs.json`
- `ai/town_population.js`
- `worldgen/town/`

Use when:

- adding names, chatter pools, or simple resident variety
- extending data used by town population/spawn rules

If the new NPC needs a brand-new interaction flow, add a narrow hook in `core/town/talk.js` and keep the text/presentation in JSON where possible.

### Shops and trade

Primary files:

- `data/shops/shops.json`
- `services/shop_service.js`
- `core/town/talk.js`

Use when:

- adding stock pools, pricing, or schedules
- changing which shop types exist

Keep inventory and schedule logic data-driven. Keep interaction rules centralized in `shop_service.js` and `talk.js`.

### Quests and town-thread text

Primary files:

- `data/quests/quests.json`
- `services/quest_service.js`
- `services/town_flavor_service.js`

Use when:

- adding a quest-board template
- changing offer/active/resolved rumor text
- extending town-situation copy

If the quest can fit the current thread model, stay in data and service code instead of adding a new runtime path.

### Followers

Primary files:

- `data/entities/followers.json`
- `core/followers_runtime.js`
- `entities/followers.js`

Use when:

- adding follower archetypes
- changing name pools, traits, or preferred gear

Follower progression is only partly data-driven today; see “Best next data-driven upgrades” below.

### Props and prefabs

Primary files:

- `data/world_assets.json`
- `data/worldgen/prefabs.json`
- `services/props_service.js`
- `worldgen/`

Use when:

- adding decor, lights, or prop interactions
- adding prefab content for towns/ruins/interiors

Prop visuals and many interaction hints are already structured for data-driven authoring.

### Smoke scenarios

Primary files:

- `smoketest/scenario_registry.js`
- `smoketest/scenarios/*.js`
- `scripts/gen_smoke_manifest.js`

Workflow:

1. add the new scenario file under `smoketest/scenarios/`
2. register it in `smoketest/scenario_registry.js`
3. run `node scripts/gen_smoke_manifest.js`
4. verify with a targeted smoke URL or targeted headless run

The smoke picker UI now reads `smoketest/scenarios.json`, so scenario metadata should be changed through the shared registry instead of editing the UI directly.
That registry now carries explicit UI metadata such as:

- `phase0`
- `group`

So if you want the picker grouped differently, edit `smoketest/scenario_registry.js` rather than adding more inference rules in the UI.

## How to decide “data” vs “code”

Use JSON when the change is:

- a new item/enemy/NPC/quest/template/prop definition
- a tuning change to values, weights, schedules, names, or text
- a new prefab or palette asset

Use code when the change is:

- a new interaction rule
- a new persistence rule
- a new mode transition
- a new AI behavior class
- a new reward/combat algorithm not expressible by existing fields

If you add code for a new concept, try to make the *next* addition data-only.

## Current recommended build loop

For normal local development:

```bash
npm run build
```

For smoke-manifest updates:

```bash
node scripts/gen_smoke_manifest.js
```

For targeted smoke checks:

```text
?smoketest=1&dev=1&scenarios=town_thief_chase&smokecount=1&autorun=0
```

Or run through the headless harness used in this repo’s slices.

## Best next data-driven upgrades

These are the most valuable remaining areas where the codebase can become more data-driven:

1. **Flavor text**
   - some town/service/runtime text is still inline in JS
   - best target files:
     - `services/quest_service.js`
     - `services/town_incident_service.js`
     - selected runtime log strings

2. **Special item effects**
   - unique curses and special on-hit/on-break rules still need a shared data-driven effect model
   - see `TODO.md` entries around special item effects

3. **Follower growth/preferences**
   - follower advancement and role shaping can be pushed further into JSON

4. **Town incident catalog**
   - incident types, rumor copy, responder counts, and spawn-role tuning can move out of code

5. **Smoke scenario grouping**
   - the manifest now carries explicit `group` and `phase0` metadata from the shared registry
   - next improvement would be optional `tags` or `recommended` flags for richer filtering without UI hardcoding

## Current optimization and simplification opportunities

These are the highest-value current opportunities based on the live code structure:

1. **`ui/ui.js` is still too broad**
   - smoke rendering moved out, but `ui/ui.js` still owns a lot of orchestration and event wiring
   - good next slices:
     - move smoke URL-building/navigation into `ui/components/smoke_modal.js`
     - continue peeling panel-specific wiring into their own components

2. **`core/town/talk.js` still mixes many interaction types**
   - recruit flow, follower inspect, harbor travel, shopkeeper logic, and generic chatter still meet in one place
   - good next slice:
     - move each special interaction branch behind narrower helpers/services while keeping `talk()` as the selector/router

3. **Town incident text is still partly code-owned**
   - `services/town_incident_service.js` still carries inline stage text
   - good next slice:
     - move incident text and type configuration to JSON so new incidents are mostly data-entry work

4. **Special item effects are still a hardcoded ceiling**
   - normal items are fairly data-driven already
   - unique/cursed/special-effect items still need a shared effect registry to avoid one-off code paths

5. **Smoke runner UI metadata can go further**
   - explicit `group` is now in the registry, which is better than inference
   - next step would be:
     - `tags`
     - `recommended`
     - `slow`
     - `requires_gm`
   - that would let the picker stay compact even as the scenario count grows

## Good small slices for future work

If you want to keep extending the game in safe phases, these are good next slices:

### Slice A — move more text to data

- target: town incidents + quest/town flavor copy
- result: easier narrative iteration without code edits

### Slice B — special item effect registry

- target: unique/cursed item behaviors
- result: future uniques become mostly data-entry work

### Slice C — follower authoring expansion

- target: follower growth, role preferences, and behavior flags
- result: more party variety through JSON instead of bespoke code

### Slice D — smoke metadata refinement

- target: explicit scenario categories/tags in the shared registry
- result: richer smoke UI without hardcoding more picker rules

## Practical rule of thumb

If you are adding content and asking “where should this live?”:

- content definition -> `data/`
- reusable logic -> `services/`
- orchestration/state transitions -> `core/`
- presentation -> `ui/`
- regression proof -> `smoketest/`

That keeps the skeleton stable and makes future additions cheaper.
