/**
 * Game bootstrap helpers extracted from core/game.js.
 *
 * These are pure functions that operate on injected dependencies so that
 * core/game.js can stay focused on state and orchestration.
 */

/**
 * Initialize mouse/click support.
 * Expects:
 * - modHandle(name): module resolver
 * - getCtx(): latest ctx
 * - getMode(): current mode string
 * - TILE: tile size in pixels
 * - getCamera(): camera object
 * - getPlayer(): { x, y }
 * - getCorpses(): array
 * - getEnemies(): array
 * - inBounds(x, y): boolean
 * - isWalkable(x, y): boolean
 * - tryMovePlayer(dx, dy): void
 * - lootCorpse(): void
 * - doAction(): void
 */
export function initMouseSupportImpl({
  modHandle,
  getCtx,
  getMode,
  TILE,
  getCamera,
  getPlayer,
  getCorpses,
  getEnemies,
  inBounds,
  isWalkable,
  tryMovePlayer,
  lootCorpse,
  doAction,
}) {
  try {
    const IM = modHandle("InputMouse");
    if (IM && typeof IM.init === "function") {
      IM.init({
        canvasId: "game",
        getMode,
        TILE,
        getCamera,
        getPlayer,
        inBounds: (x, y) => inBounds(x, y),
        isWalkable: (x, y) => isWalkable(x, y),
        getCorpses: () => getCorpses(),
        getEnemies: () => getEnemies(),
        tryMovePlayer: (dx, dy) => tryMovePlayer(dx, dy),
        lootCorpse: () => lootCorpse(),
        doAction: () => doAction(),
        isAnyModalOpen: () => {
          const UIO = modHandle("UIOrchestration");
          return !!(
            UIO &&
            typeof UIO.isAnyModalOpen === "function" &&
            UIO.isAnyModalOpen(getCtx())
          );
        },
      });
    }
  } catch (_) {}
}

/**
 * Start the render loop (or draw once if loop module is unavailable).
 * Expects:
 * - modHandle(name)
 * - getRenderCtx(): render context
 */
export function startLoopImpl({ modHandle, getRenderCtx }) {
  const GL = modHandle("GameLoop");
  if (GL && typeof GL.start === "function") {
    GL.start(() => getRenderCtx());
  } else {
    const R = modHandle("Render");
    if (R && typeof R.draw === "function") {
      R.draw(getRenderCtx());
    }
  }
}

/**
 * Request a redraw once assets (e.g., tiles.json) have fully loaded.
 * Expects:
 * - requestDraw(): schedules a draw via GameLoop/Render orchestrator
 */
export function scheduleAssetsReadyDrawImpl({ requestDraw }) {
  try {
    if (
      typeof window !== "undefined" &&
      window.GameData &&
      window.GameData.ready &&
      typeof window.GameData.ready.then === "function"
    ) {
      window.GameData.ready.then(() => {
        // Request a draw which will rebuild offscreen caches against the now-loaded tiles.json
        requestDraw();
      });
    }
  } catch (_) {}
}