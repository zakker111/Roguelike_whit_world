// Generate Smoke Test scenarios manifest from smoketest/scenarios/
// Run: node scripts/gen_smoke_manifest.js
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());
const SCEN_DIR = path.join(ROOT, "smoketest", "scenarios");
const OUT_FILE = path.join(ROOT, "smoketest", "scenarios.json");

function toLabel(id) {
  // Convert "dungeon_persistence" -> "Dungeon Persistence"
  try {
    const parts = String(id || "").split("_").filter(Boolean);
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    return parts.map(cap).join(" ");
  } catch (_) {
    return String(id || "");
  }
}

function main() {
  const entries = fs.readdirSync(SCEN_DIR, { withFileTypes: true });
  const scenarios = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (ext !== ".js") continue;
    const base = path.basename(e.name, ext);
    if (base.toLowerCase() === "README.md".toLowerCase()) continue;
    scenarios.push({ id: base, label: toLabel(base) });
  }
  scenarios.sort((a, b) => a.id.localeCompare(b.id));
  const json = { scenarios };
  fs.writeFileSync(OUT_FILE, JSON.stringify(json, null, 2), "utf8");
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE).replace(/\\/g, "/")} with ${scenarios.length} scenarios`);
}

main();