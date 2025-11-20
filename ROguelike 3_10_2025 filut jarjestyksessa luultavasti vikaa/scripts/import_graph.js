// Import graph: finds JS modules reachable from src/main.js and lists unreferenced modules.
// Run: node scripts/import_graph.js
import fs from "fs";
import path from "path";

const ROOT = path.resolve(path.join(process.cwd(), "ROguelike 3_10_2025 filut jarjestyksessa luultavasti vikaa"));
const ENTRY = "src/main.js";
const OUT_DIR = path.join(ROOT, "analysis");
const OUT_FILE = path.join(OUT_DIR, "unreferenced_modules.md");

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "scripts",    // tooling scripts
  "analysis",   // reports
  "docs",       // static docs
  "tools"       // editor tools
]);

// Directories that are part of the runtime graph (front-end ESM)
const RUNTIME_DIRS = new Set([
  "src",
  "core",
  "ui",
  "utils",
  "data",
  "entities",
  "dungeon",
  "world",
  "worldgen",
  "services",
  "combat",
  "ai",
  "region_map",
  "smoketest"
]);

function norm(p) {
  // Normalize to POSIX-style relative path
  const rel = path.relative(ROOT, p).replace(/\\/g, "/");
  return rel;
}

function resolveImport(fromFile, imp) {
  // Convert browser-root and relative imports to normalized file paths.
  try {
    if (!imp || typeof imp !== "string") return null;
    // Ignore external URLs or packages
    if (/^(https?:\/\/|data:|blob:)/.test(imp)) return null;
    if (!imp.endsWith(".js")) {
      // Only handle explicit JS module imports in this project
      return null;
    }
    if (imp.startsWith("/")) {
      // Browser root import
      const target = imp.slice(1); // drop leading '/'
      return target;
    }
    if (imp.startsWith("./") || imp.startsWith("../")) {
      const fromDir = path.dirname(fromFile);
      const abs = path.resolve(ROOT, fromDir, imp);
      return norm(abs);
    }
    // Bare specifier: ignore (no packages used in browser runtime)
    return null;
  } catch {
    return null;
  }
}

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip heavy/non-runtime dirs
      const base = e.name;
      if (EXCLUDE_DIRS.has(base)) continue;
      yield* walk(full);
    } else {
      if (path.extname(e.name) === ".js") {
        const rel = norm(full);
        const top = rel.split("/")[0];
        if (RUNTIME_DIRS.has(top)) {
          yield full;
        }
      }
    }
  }
}

function parseImports(content) {
  const out = new Set();
  // Static ESM imports
  const reStatic = /import\s+(?:[^'"]*?from\s+)?["']([^"']+)["']/g;
  // Side-effect imports: import "module.js";
  const reSide = /import\s+["']([^"']+)["']/g;
  // Dynamic imports: import("module.js")
  const reDyn = /import\(\s*["']([^"']+)["']\s*\)/g;

  let m;
  while ((m = reStatic.exec(content))) out.add(m[1]);
  while ((m = reSide.exec(content))) out.add(m[1]);
  while ((m = reDyn.exec(content))) out.add(m[1]);
  return Array.from(out);
}

function buildGraph() {
  const files = Array.from(walk(ROOT));
  const graph = new Map(); // file -> Set(imports)
  const byRel = new Map(); // rel -> abs

  for (const f of files) {
    const rel = norm(f);
    byRel.set(rel, f);
    let content = "";
    try { content = fs.readFileSync(f, "utf8"); } catch { content = ""; }
    const imps = parseImports(content);
    const edges = new Set();
    for (const imp of imps) {
      const target = resolveImport(rel, imp);
      if (target) edges.add(target);
    }
    graph.set(rel, edges);
  }
  return { graph, byRel };
}

function reachableFrom(entry, graph) {
  const seen = new Set();
  const q = [entry];
  while (q.length) {
    const cur = q.pop();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    const edges = graph.get(cur);
    if (edges && edges.size) {
      for (const nxt of edges) {
        if (!seen.has(nxt)) q.push(nxt);
      }
    }
  }
  return seen;
}

function writeReport(unref) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = [];
  lines.push("# Unreferenced JS modules");
  lines.push("");
  lines.push("These modules are not reachable from src/main.js via ESM imports (including dynamic imports).");
  lines.push("They can likely be removed or should be imported explicitly if required.");
  lines.push("");
  const list = Array.from(unref).sort();
  for (const f of list) {
    lines.push("- " + f);
  }
  lines.push("");
  lines.push("Run this script after refactors to keep the repository lean.");
  fs.writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
  console.log("Wrote " + norm(OUT_FILE));
}

function main() {
  const { graph } = buildGraph();
  const entry = ENTRY;
  const reach = reachableFrom(entry, graph);
  const all = new Set(graph.keys());
  // Filter to runtime dirs
  const unref = new Set();
  for (const f of all) {
    if (!reach.has(f)) unref.add(f);
  }
  // Exempt smoketest legacy runner shim if present (dynamic under &legacy=1)
  // but it should still be captured from src/main.js when ?legacy=1 is used.
  writeReport(unref);
}

main();