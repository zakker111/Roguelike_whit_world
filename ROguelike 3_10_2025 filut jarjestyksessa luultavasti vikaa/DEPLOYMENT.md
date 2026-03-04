# Deployment Checklist (Tiny Roguelike)

This repo can be deployed in two ways:

- **Preferred (production)**: build with Vite and deploy the `dist/` folder.
- **Fallback (no build)**: deploy the repo root as a static site (native ESM). This is convenient but ships dev sources.

## 0) Pick the output folder

**Production:** `dist/`

- Created by: `npm run build`
- Validated by: `npm run artifact:check`

**Fallback:** repo root

- Must contain: `index.html`, `src/`, `data/`, `ui/`.

## 1) Pre-deploy changes (content/versioning)

- [ ] Update `package.json` version (optional, but recommended).
- [ ] Update `meta[name="app-version"]` in `index.html` (recommended).
  - This triggers version-based localStorage clearing on deploy.
- [ ] If behavior/content changed, update docs as needed:
  - [ ] `FEATURES.md`, `BUGS.md`, `TODO.md`, and/or `VERSIONS.md`.
- [ ] If you rely on runtime-fetched JSON, confirm new/renamed files are in `data/`.

## 2) Local verification (before deploy)

From the repo root:

- [ ] Install deps:
  - `npm install`
- [ ] Lint:
  - `npm run lint:strict`
- [ ] Node tests (GM sims):
  - `npm test`

### If deploying `dist/`

- [ ] Build:
  - `npm run build`
- [ ] Confirm the output folder is valid:
  - `npm run artifact:check`
- [ ] Optional local smoke preview:
  - `npm run preview` (serves `dist/` at http://localhost:8080)

### If deploying repo root (no build)

- [ ] Sanity: open `index.html` via a local static server (recommended):
  - `node server.js` (serves at http://localhost:8080)

## 3) Deploy (Cosine Instant Sites)

- [ ] Ensure **Instant Sites** is enabled in Cosine project settings.
- [ ] Deploy the folder:
  - Production: deploy `dist/`
  - Fallback: deploy the repo root

## 4) Post-deploy verification (required)

- [ ] Open the deployed URL and confirm the build identity:
  - In-game logs include: `Health: Build -> version=<...> origin=<...>`
- [ ] Confirm runtime assets load (no 404s):
  - `/data/world/world_assets.json`
  - `/smoketest/scenarios.json`
  - `/docs/index.html`
- [ ] Run the browser smoketest runner:
  - `/index.html?smoketest=1`
  - Suggested reduced set: `?smoketest=1&scenarios=world,dungeon,overlays&smokecount=3`
- [ ] Check auxiliary pages still work:
  - `/gm_sim.html`
  - `/gm_emission_sim.html`

## 5) Rollback plan

- Keep the previous deployment URL from `VERSIONS.md`.
- If the new deploy is bad, redeploy the last known-good `dist/` artifact.
