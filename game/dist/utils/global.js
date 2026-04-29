// Minimal helpers to attach globals for legacy scripts without repeating boilerplate.

/**
 * Attach a value to window under a given name if window is available.
 * No-op in non-browser environments.
 */
export function attachGlobal(name, value) {
  try {
    if (typeof window !== "undefined") {
      window[name] = value;
    }
  } catch (_) {}
}

/**
 * Back-compat alias to emphasize conditional attach.
 */
export const attachIfWindow = attachGlobal;