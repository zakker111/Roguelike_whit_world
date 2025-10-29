// Generate a file manifest for client-side analysis.
// Run: node scripts/gen_manifest.js
import fs from "fs";
import path from "path";

const ROOT = path.resolve(path.join(process.cwd(), "ROguelike 3_10_2025 filut jarjestyksessa luultavasti vikaa"));
const OUT_DIR = path.join(ROOT, "analysis");
const OUT_FILE = path.join(OUT_DIR, "file_manifest.json");

// Include common web assets
const INCLUDE_EXT = new Set([".js", ".json", ".css", ".html"]);
// Exclude noisy or irrelevant directories
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", ".vite"]);

// Walk filesystem and collect matching files
function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else {
      const ext = path.extname(e.name);
      if (INCLUDE_EXT.has(ext)) {
        yield full;
      }
    }
  }
}

function relWebPath(absPath) {
  // Convert absolute file path under ROOT to a site-root absolute URL path
  const rel = path.relative(ROOT, absPath).replace(/\\/g, "/");
  return `/${rel}`;
}

function main() {
  const files = Array.from(walk(ROOT));
  // Sort for stable output
  files.sort((a, b) => a.localeCompare(b));
  const manifest = files.map(relWebPath);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE).replace(/\\/g, "/")} with ${manifest.length} entries`);
}

main();