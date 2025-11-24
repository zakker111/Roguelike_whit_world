Services

Purpose
- Shared services for time/schedules, shops/trade, encounters, props/lighting, messages/flavor, quests, stats, etc.

Key modules
- time_service.js — in-game clock and schedules (shop hours, NPC routines).
- shop_service.js — shop inventory, bump-shop interactions, pricing and gold ops.
- props_service.js — decorative/functional props (lamps, fireplaces) and emitted light.
- encounter_service.js — random encounter orchestration, difficulty scaling, special multi-faction templates (night raids, Guards vs Bandits), biome-themed maps, and entry/exit wiring.
- messages.js — logging and contextual messages.
- flavor_service.js — flavor strings and narrative snippets.
- quest_service.js — basic quest board and hooks.
- stats_service.js — stat-related helpers and shared calculations.
- weather_service.js — non-gameplay visual weather state machine (clear/cloudy/foggy/light/heavy rain) driven by data/config/weather.json; feeds overlays and HUD weather labels.

Notes
- Services are pure modules; integration occurs via core runtimes and UIBridge.
- Wild Seppo merchant appearances are coordinated via time_service and town runtime.