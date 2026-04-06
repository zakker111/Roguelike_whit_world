export function createGameCanvasRuntime({ COLS, ROWS, TILE }) {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const camera = {
    x: 0,
    y: 0,
    width: COLS * TILE,
    height: ROWS * TILE,
  };

  return { canvas, ctx, camera };
}
