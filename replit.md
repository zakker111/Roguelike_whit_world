# Tiny Roguelike

A browser-based roguelike game (vanilla JavaScript + Vite). Imported from GitHub and configured to run in the Replit environment.

## Project Layout

The actual project lives inside the directory `game/`.

Key folders inside the main project directory:
- `index.html` – game entry point
- `src/`, `core/`, `combat/`, `dungeon/`, `world/`, `region_map/`, `entities/`, `ai/`, `ui/`, `services/`, `utils/`, `worldgen/` – game code
- `data/` – static game data
- `scripts/` – build / analysis scripts
- `dist/` – build output

## Tech Stack

- Node.js 20
- Vite 5 (dev server and bundler)
- Vanilla ES modules, no framework

## Replit Setup

- Workflow `Start application` runs `cd game && npm run dev -- --host 0.0.0.0 --port 5000`.
- `vite.config.js` is configured to bind `0.0.0.0:5000`, allow all hosts (required for the Replit iframe proxy), and disable HMR (the page's CSP forbids the dev WebSocket).
- Deployment is configured as a static site:
  - Build: `cd game && npm install && npm run build`
  - Public dir: `game/dist`

## Useful Commands (run from the project directory)

- `npm run dev` – start the Vite dev server
- `npm run build` – production build into `dist/`
- `npm run preview` – preview a built bundle
