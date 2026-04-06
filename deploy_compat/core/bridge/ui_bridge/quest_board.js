// ---- Quest Board panel wrappers ----

export function isQuestBoardOpen() {
  try {
    if (typeof window !== "undefined" && window.QuestBoardUI && typeof window.QuestBoardUI.isOpen === "function") {
      return !!window.QuestBoardUI.isOpen();
    }
  } catch (_) {}
  return false;
}

export function showQuestBoard(ctx) {
  try {
    if (typeof window !== "undefined" && window.QuestBoardUI && typeof window.QuestBoardUI.open === "function") {
      window.QuestBoardUI.open(ctx);
      return;
    }
  } catch (_) {}
}

export function hideQuestBoard(ctx) {
  try {
    if (typeof window !== "undefined" && window.QuestBoardUI && typeof window.QuestBoardUI.hide === "function") {
      window.QuestBoardUI.hide();
      return;
    }
  } catch (_) {}
}
