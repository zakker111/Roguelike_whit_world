import { U } from "./shared.js";

export function updateStats(ctx) {
  const u = U(ctx);
  if (u && typeof u.updateStats === "function") {
    u.updateStats(ctx);
  }
}
