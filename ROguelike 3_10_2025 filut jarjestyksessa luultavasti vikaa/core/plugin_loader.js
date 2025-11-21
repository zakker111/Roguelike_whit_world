// Plugin loader: reads data/plugins.json and imports modules.
// Each plugin module may export:
//   - setup(registry, ctx): optional; called with PluginRegistry and a minimal ctx.
//   - default export or named exports to be registered when manifest provides {type, id}.
//
// Manifest format (data/plugins.json):
// {
//   "plugins": [
//     { "path": "/plugins/example_pack.js" },
//     { "type": "encounter", "id": "bandits", "path": "/plugins/encounters/bandits.js" }
//   ]
// }

import { register } from '/core/plugin_registry.js';

async function fetchManifest(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || !Array.isArray(json.plugins)) return null;
    return json;
  } catch (_) {
    return null;
  }
}

function makeCtx() {
  const ctx = {};
  try { ctx.GameData = typeof window !== 'undefined' ? window.GameData : null; } catch (_) {}
  try { ctx.Logger = typeof window !== 'undefined' ? window.Logger : null; } catch (_) {}
  try { ctx.RNG = typeof window !== 'undefined' ? window.RNG : null; } catch (_) {}
  return ctx;
}

async function loadPluginEntry(entry, ctx) {
  const path = String(entry.path || '');
  if (!path) return;
  let mod = null;
  try {
    mod = await import(path);
  } catch (e) {
    try {
      if (typeof window !== 'undefined' && window.Logger && typeof window.Logger.log === 'function') {
        window.Logger.log('[Plugin] import failed ' + path, 'bad', { category: 'Services', error: (e && e.message) ? e.message : String(e) });
      }
    } catch (_) {}
    return;
  }

  // If the module exposes setup(), call it with registry and ctx
  try {
    if (mod && typeof mod.setup === 'function') {
      mod.setup(window.PluginRegistry || { register }, ctx);
    }
  } catch (_) {}

  // If manifest provided type/id, register a default export or module
  const t = entry.type ? String(entry.type) : null;
  const id = entry.id ? String(entry.id) : null;
  if (t && id) {
    const pluginObj = (mod && ('default' in mod)) ? mod.default : mod;
    try { register(t, id, pluginObj); } catch (_) {}
  }

  // Optional log on success
  try {
    if (typeof window !== 'undefined' && window.Logger && typeof window.Logger.log === 'function') {
      const name = id ? (t + ':' + id) : path;
      window.Logger.log('[Plugin] loaded ' + name, 'notice', { category: 'Services' });
    }
  } catch (_) {}
}

async function bootstrap() {
  // Wait for GameData.ready when available to ensure registries are loaded
  const ctx = makeCtx();
  const manifestUrl = 'data/plugins.json';
  const manifest = await fetchManifest(manifestUrl);
  if (!manifest) {
    // Silent when missing; optional file
    return;
  }
  const entries = Array.isArray(manifest.plugins) ? manifest.plugins : [];
  for (const entry of entries) {
    await loadPluginEntry(entry, ctx);
  }
}

try {
  // If GameData.ready exists, defer loading until then
  const GD = (typeof window !== 'undefined' ? window.GameData : null);
  if (GD && GD.ready && typeof GD.ready.then === 'function') {
    GD.ready.then(() => { bootstrap(); });
  } else {
    bootstrap();
  }
} catch (_) {}