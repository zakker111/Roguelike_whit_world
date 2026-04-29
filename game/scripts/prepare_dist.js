// Prepare a self-contained dist/ deployment artifact after Vite builds the bundle.
// Run via: npm run build
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());
const DIST = path.join(ROOT, "dist");

const COPY_PATHS = [
  "data",
  "src",
  "core",
  "ui",
  "services",
  "ai",
  "combat",
  "dungeon",
  "entities",
  "region_map",
  "utils",
  "world",
  "worldgen",
  "docs",
  "smoketest",
  "tools",
  "README.md",
  "VERSIONS.md",
  "FEATURES.md",
  "TODO.md",
  "BUGS.md",
  "CHECKLIST.md",
  "smoketest.md",
  "gm_sim.html",
  "gm_sim.js",
  "gm_emission_sim.html",
  "gm_emission_sim.js",
];

function copyIntoDist(relPath) {
  const src = path.join(ROOT, relPath);
  if (!fs.existsSync(src)) return;
  const dest = path.join(DIST, relPath);
  const stat = fs.statSync(src);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (stat.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true });
    return;
  }
  fs.copyFileSync(src, dest);
}

function main() {
  if (!fs.existsSync(DIST) || !fs.statSync(DIST).isDirectory()) {
    throw new Error("dist/ does not exist; run vite build before prepare_dist.");
  }

  for (const relPath of COPY_PATHS) {
    copyIntoDist(relPath);
  }

  console.log(`Prepared self-contained dist/ artifact with ${COPY_PATHS.length} copied runtime paths.`);
}

main();
