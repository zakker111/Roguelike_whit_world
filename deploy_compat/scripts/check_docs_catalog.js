// Validate that docs/index.html catalog paths exist on disk.
// Run: node scripts/check_docs_catalog.js
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = path.resolve(process.cwd());
const DOCS_INDEX = path.join(ROOT, "docs", "index.html");

function findCatalogArraySource(html) {
  const needle = "const catalog";
  const startAt = html.indexOf(needle);
  if (startAt === -1) {
    throw new Error(`Unable to find '${needle}' in docs/index.html`);
  }

  const bracketStart = html.indexOf("[", startAt);
  if (bracketStart === -1) {
    throw new Error("Unable to find catalog array '['");
  }

  let i = bracketStart;
  let depth = 0;

  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  for (; i < html.length; i++) {
    const ch = html[i];
    const next = i + 1 < html.length ? html[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingle) {
      if (!escape && ch === "'") inSingle = false;
      escape = !escape && ch === "\\";
      continue;
    }

    if (inDouble) {
      if (!escape && ch === '"') inDouble = false;
      escape = !escape && ch === "\\";
      continue;
    }

    if (inTemplate) {
      if (!escape && ch === "`") inTemplate = false;
      escape = !escape && ch === "\\";
      continue;
    }

    // Not in string/comment.
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      escape = false;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      escape = false;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      escape = false;
      continue;
    }

    if (ch === "[") {
      depth++;
      continue;
    }
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        return html.slice(bracketStart, i + 1);
      }
      continue;
    }
  }

  throw new Error("Unable to find end of catalog array (missing ']')");
}

function evalCatalog(arraySource) {
  // Evaluate the array literal in a locked-down VM context.
  const ctx = vm.createContext(Object.freeze({}));
  const script = new vm.Script(`(${arraySource})`, { filename: "docs/index.html" });
  const value = script.runInContext(ctx, { timeout: 250 });
  if (!Array.isArray(value)) {
    throw new Error("Parsed catalog is not an array");
  }
  return value;
}

function stripQueryAndHash(p) {
  return p.split("#")[0].split("?")[0];
}

function toDiskPath(webPath) {
  const p = stripQueryAndHash(webPath);
  return path.resolve(ROOT, p);
}

function main() {
  if (!fs.existsSync(DOCS_INDEX)) {
    console.error(`Missing docs index at ${path.relative(ROOT, DOCS_INDEX)}`);
    process.exit(1);
  }

  const html = fs.readFileSync(DOCS_INDEX, "utf8");
  const arraySource = findCatalogArraySource(html);
  const catalog = evalCatalog(arraySource);

  const missing = [];
  for (const entry of catalog) {
    const p = entry && typeof entry === "object" ? entry.path : undefined;
    if (typeof p !== "string" || !p.trim()) {
      missing.push({ entry, reason: "missing/invalid path" });
      continue;
    }

    if (/^[a-zA-Z]+:\/\//.test(p)) {
      // External link: nothing to validate on disk.
      continue;
    }

    const diskPath = toDiskPath(p);
    if (!fs.existsSync(diskPath)) {
      missing.push({ entry, reason: `not found: ${path.relative(ROOT, diskPath)}` });
      continue;
    }

    const st = fs.statSync(diskPath);
    if (!st.isFile()) {
      missing.push({ entry, reason: `not a file: ${path.relative(ROOT, diskPath)}` });
    }
  }

  if (missing.length) {
    console.error(`Docs catalog path validation failed (${missing.length} issue(s)):`);
    for (const m of missing) {
      const title = m.entry && m.entry.title ? String(m.entry.title) : "<no title>";
      const p = m.entry && m.entry.path ? String(m.entry.path) : "<no path>";
      console.error(`- ${title}: ${p} (${m.reason})`);
    }
    process.exit(1);
  }

  console.log(`Docs catalog OK (${catalog.length} entries)`);
}

main();
