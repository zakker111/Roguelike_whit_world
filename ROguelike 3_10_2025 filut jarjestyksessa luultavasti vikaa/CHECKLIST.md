# Smoke Test Runner Checklist

Version: Runner v1.8.0

This document lists what the automated Smoke Test runner attempts on each run and what is reported.

## Setup and Global

- Seed per run
  - Applies a unique 32-bit seed for each run in a series; seed is shown in report.
- FOV adjust
  - Adjusts FOV (if control exists), otherwise skipped.
- Mode/status display
  - Live status line shows current mode: [world] / [dungeon] / [town] and the current step.

## Dungeon Flow

- Route to nearest dungeon (timeboxed)
  - Uses BFS route; marked Skipped if routing exceeds budget.
- Enter dungeon
  - Enter key + API fallback.
- Chest loot
  - Finds chest in start room; routes to it; presses G to loot.
- Equip best from inventory
  - Equips better items from inventory; lists item names equipped.
- Enemy engagement and decay
  - Spawns a test enemy; routes to it; performs short combat; checks weapon decay increased.
- Loot corpse
  - Presses G to loot underfoot after combat.
- Exit dungeon
  - Routes to dungeon exit (‘>’) and presses G to return to overworld.

## Town Flow

- Route to nearest town (timeboxed)
  - BFS route; multiple entry fallbacks:
    - Enter key
    - API enterTownIfOnTile
    - Step onto adjacent TOWN tile then enter
    - Small-radius scan/route to TOWN tile then enter
- NPC interaction
  - Finds nearest NPC; moves adjacent; bumps into NPC.
- NPC home and decorations
  - Uses NPC index to fetch home building; verifies decorations/props exist inside; routes to door;
    routes inside; presses G to interact with a prop.
- Town prop interaction
  - Routes to nearest town prop; presses G.
- Shop schedule
  - Reports shop name, open/closed state, and schedule text.
- Home routes diagnostic
  - Runs TownAI.checkHomeRoutes; verifies residents exist; includes unreachable count.

## Diagnostics and Reporting

- GOD Diagnostics
  - Opens diagnostics and reports success.
- Console/browser error capture
  - Captures console.error, console.warn, window.onerror, and unhandledrejection; summarized in Issues.
- Live Matchup scoreboard (GOD panel)
  - Sticky/pinned panel at the top of the GOD output.
  - Shows OK/FAIL/SKIP counts; FAIL highlighted.
  - Details prioritize FAIL first, then SKIP, then OK; shows up to 20 by default; Expand to show all aggregated steps.
- Per-run report (GOD panel)
  - Issues: failures + captured console/browser errors
  - Passed: all successful checks
  - Skipped: skipped checks with reasons (e.g., timeouts, missing controls)
  - Details: full step-by-step with OK/ERR/SKIP
- Series summary (after multi-run)
  - Runs pass/fail; total checks passed/failed/skipped
  - Performance averages (turn/draw) + soft budget warnings
  - Runner version and capability list
  - Aggregated report (union of success across runs)
- Export
  - JSON: complete machine-readable report
  - TXT: single-file summary (GOOD/PROBLEMS/SKIPPED + top console/browser issues)

## Determinism and Performance

- Determinism (single-run emphasis)
  - First enemy type on dungeon floor
  - Chest loot items (start room)
  - NPC|prop sample in town
- Performance budgets
  - Warns if average turn > 6 ms or average draw > 12 ms (configurable).

## Future-Proofing Behaviors

- Capability detection
  - Detects GameAPI features and UI controls; safely skips missing features.
- Timeboxed sequences
  - Routing, interactions, combat are run under time budgets; Skipped if exceeded.
- Resilient entry
  - Multiple fallbacks to ensure town entry succeeds even if input focus/timing varies.

## Pass Criteria

- No ERR steps.
- Town and dungeon sequences show multiple PASS lines (e.g., Entered town, Bumped into NPC, Chest looted, Decay increased).
- Series summary: failed checks = 0; performance warnings are acceptable or absent.
- Issues (console/browser) are empty or minimal.