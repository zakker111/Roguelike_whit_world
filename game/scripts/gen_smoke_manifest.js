// Generate Smoke Test scenarios manifest from smoketest/scenarios/
// Run: node scripts/gen_smoke_manifest.js
import fs from "fs";
import path from "path";
import { SMOKE_SCENARIOS } from "../smoketest/scenario_registry.js";

const ROOT = path.resolve(process.cwd());
const SCEN_DIR = path.join(ROOT, "smoketest", "scenarios");
const OUT_FILE = path.join(ROOT, "smoketest", "scenarios.json");

function main() {
  const entries = fs.readdirSync(SCEN_DIR, { withFileTypes: true });
  const fileSet = new Set(
    entries
      .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === ".js")
      .map((e) => path.basename(e.name, ".js"))
  );
  const scenarios = SMOKE_SCENARIOS.map(({ id, label, phase0, group }) => ({
    id,
    label,
    phase0: !!phase0,
    group: group || "misc",
  }));
  const missingFiles = SMOKE_SCENARIOS
    .filter(({ id }) => !fileSet.has(id))
    .map(({ id }) => id);
  if (missingFiles.length) {
    throw new Error(`Scenario registry references missing files: ${missingFiles.join(", ")}`);
  }
  const json = { scenarios };
  fs.writeFileSync(OUT_FILE, JSON.stringify(json, null, 2), "utf8");
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE).replace(/\\/g, "/")} with ${scenarios.length} scenarios`);
}

main();
