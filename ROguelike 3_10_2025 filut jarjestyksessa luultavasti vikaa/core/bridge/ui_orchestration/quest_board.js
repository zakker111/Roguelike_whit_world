import { U } from "./shared.js";
import { requestDraw } from "./draw.js";

export function showQuestBoard(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isQuestBoardOpen === "function") wasOpen = !!u.isQuestBoardOpen();
  } catch (_) {}
  if (u && typeof u.showQuestBoard === "function") {
    u.showQuestBoard(ctx);
    if (!wasOpen) requestDraw(ctx);
  }
}

export function hideQuestBoard(ctx) {
  const u = U(ctx);
  let wasOpen = false;
  try {
    if (u && typeof u.isQuestBoardOpen === "function") wasOpen = !!u.isQuestBoardOpen();
  } catch (_) {}
  if (u && typeof u.hideQuestBoard === "function") {
    u.hideQuestBoard(ctx);
    if (wasOpen) requestDraw(ctx);
  }
}

export function isQuestBoardOpen(ctx) {
  const u = U(ctx);
  try {
    if (u && typeof u.isQuestBoardOpen === "function") return !!u.isQuestBoardOpen();
  } catch (_) {}
  return false;
}
