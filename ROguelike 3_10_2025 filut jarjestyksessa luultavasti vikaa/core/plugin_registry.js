// Simple plugin registry for modular extensions.
// Types are arbitrary strings (e.g., 'worldgen', 'encounter', 'ai', 'combat', 'tiles', 'props', 'shops', 'ui').

const REG = Object.create(null);

function ensureType(t) {
  const k = String(t || '');
  if (!REG[k]) REG[k] = Object.create(null);
  return k;
}

export function register(type, id, plugin) {
  const t = ensureType(type);
  const name = String(id || '');
  REG[t][name] = plugin;
}

export function get(type, id) {
  const t = String(type || '');
  const name = String(id || '');
  const bucket = REG[t];
  return bucket ? bucket[name] : undefined;
}

export function list(type) {
  const t = String(type || '');
  const bucket = REG[t];
  if (!bucket) return [];
  return Object.keys(bucket).map((id) => ({ id, plugin: bucket[id] }));
}

// Expose a minimal global for plugins that prefer window access
try {
  // Do not overwrite if already present
  if (typeof window !== 'undefined') {
    if (!window.PluginRegistry) {
      window.PluginRegistry = { register, get, list };
    }
  }
} catch (_) {}