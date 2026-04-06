// Phase 1 analysis: size and duplication report for JS/JSON files
// Run: node scripts/analyze.js
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, "analysis");
const OUT_FILE = path.join(OUT_DIR, "phase1_report.md");

const INCLUDE_EXT = new Set([".js", ".json", ".css", ".html"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git"]);

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else {
      const ext = path.extname(e.name);
      if (INCLUDE_EXT.has(ext)) yield full;
    }
  }
}

function countLines(content) {
  if (content.length === 0) return 0;
  // Normalize CRLF/CR
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").length;
}

// 3-line shingle duplication detection (approximate)
function shingles(content, k = 3) {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i + k <= lines.length; i++) {
    const chunk = lines.slice(i, i + k)
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .join("\n");
    if (chunk.length >= 30) out.push(chunk);
  }
  return out;
}

function hashStr(s) {
  // FNV-like simple hash
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

function main() {
  const files = Array.from(walk(ROOT));
  const metrics = [];
  const shingleMap = new Map(); // hash -> { text, files:Set, count }
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8");
    const lines = countLines(content);
    metrics.push({ file: rel(f), lines });

    if (path.extname(f) === ".js") {
      const snips = shingles(content, 3);
      const seen = new Set();
      for (const s of snips) {
        const h = hashStr(s);
        if (seen.has(h)) continue; // avoid counting duplicates within same file more than once
        seen.add(h);
        let entry = shingleMap.get(h);
        if (!entry) {
          entry = { text: s, files: new Set(), count: 0 };
          shingleMap.set(h, entry);
        }
        entry.files.add(rel(f));
        entry.count += 1;
      }
    }
  }

  metrics.sort((a, b) => b.lines - a.lines);
  const topFiles = metrics.slice(0, 20);

  const duplicates = [];
  for (const [h, entry] of shingleMap.entries()) {
    if (entry.files.size >= 2) {
      duplicates.push({
        hash: h,
        count: entry.count,
        files: Array.from(entry.files).sort(),
        preview: entry.text.slice(0, 300)
      });
    }
  }
  duplicates.sort((a, b) => b.files.length - a.files.length || b.count - a.count);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = [];

  lines.push("# Phase 1 Report: Size and Duplication");
  lines.push("");
  lines.push("This report summarizes file sizes and approximate duplicated 3-line code shingles across JavaScript files.");
  lines.push("");
  lines.push("## Top 20 largest files by line count");
  lines.push("");
  for (const m of topFiles) {
    lines.push(`- ${m.file} — ${m.lines} lines`);
  }
  lines.push("");
  lines.push("## Detected duplicated snippets (approximate)");
  lines.push("");
  lines.push("A snippet listed below appears in 2+ files. Use these to guide refactors (extract helpers, centralize services).");
  lines.push("");
  const maxDup = Math.min(50, duplicates.length);
  for (let i = 0; i < maxDup; i++) {
    const d = duplicates[i];
    lines.push(`- Hash ${d.hash} — appears ${d.files.length} files (count=${d.count}):`);
    lines.push(d.files.map(f => `  - ${f}`).join("\n"));
    lines.push("  Preview:");
    const preview = d.preview.replace(/\n/g, " \\n ");
    lines.push(`  \"${preview}\"`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("- This duplication detector is heuristic; it may over/under-report. Use it to spot clear DRY opportunities.");
  lines.push("- Regenerate the report after refactors to see improvements: `node scripts/analyze.js`.");

  fs.writeFileSync(OUT_FILE, lines.join("\n"), "utf8");
  console.log(`Wrote ${rel(OUT_FILE)}`);
}

main();