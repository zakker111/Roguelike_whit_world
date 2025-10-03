/**
 * Tileset: optional sprite atlas support with graceful fallback.
 *
 * Exports (window.Tileset):
 * - configure({ imageUrl?, tileSize?, map? }): set image URL, tile size and key->frame mapping
 * - isReady(): boolean
 * - draw(ctx2d, key, x, y, size): draws the tile at screen position; returns true if drawn via atlas
 * - getTileSize(): current atlas tile size
 *
 * Notes:
 * - If no image is configured/loaded or key is unmapped, draw() returns false so callers can fallback.
 * - Coordinates in map are tile coordinates: { x: col, y: row }.
 */
(function () {
  const Tileset = {
    _img: null,
    _ready: false,
    _tileSize: 32,
    _map: Object.create(null),

    configure(opts = {}) {
      if (typeof opts.tileSize === "number" && opts.tileSize > 0) {
        this._tileSize = opts.tileSize | 0;
      }
      if (opts.map && typeof opts.map === "object") {
        this._map = Object.assign({}, this._map, opts.map);
      }
      if (opts.imageUrl && typeof opts.imageUrl === "string") {
        const img = new Image();
        img.onload = () => { this._img = img; this._ready = true; };
        img.onerror = () => { this._img = null; this._ready = false; };
        img.src = opts.imageUrl;
      }
    },

    isReady() {
      return !!(this._img && this._ready);
    },

    getTileSize() {
      return this._tileSize;
    },

    // Draw a frame by key; returns true if drawn via atlas, false for fallback
    draw(ctx2d, key, x, y, size) {
      if (!this.isReady()) return false;
      const frame = this._map[key];
      if (!frame) return false;
      const ts = this._tileSize;
      const sx = (frame.x | 0) * ts;
      const sy = (frame.y | 0) * ts;
      const sw = ts;
      const sh = ts;
      const dw = size || ts;
      const dh = size || ts;
      try {
        ctx2d.drawImage(this._img, sx, sy, sw, sh, x | 0, y | 0, dw, dh);
        return true;
      } catch (_) {
        return false;
      }
    },

    // Draw with temporary alpha applied; restores previous alpha afterward.
    drawAlpha(ctx2d, key, x, y, size, alpha) {
      if (!this.isReady()) return false;
      const prev = ctx2d.globalAlpha;
      if (typeof alpha === "number") {
        const a = Math.max(0, Math.min(1, alpha));
        ctx2d.globalAlpha = a;
      }
      const ok = this.draw(ctx2d, key, x, y, size);
      ctx2d.globalAlpha = prev;
      return ok;
    },
  };

  // Provide a minimal default mapping; can be extended via configure()
  Tileset.configure({
    tileSize: 32,
    map: {
      floor: { x: 0, y: 0 },
      wall: { x: 1, y: 0 },
      door: { x: 2, y: 0 },
      stairs: { x: 3, y: 0 },
      chest: { x: 4, y: 0 },
      corpse: { x: 5, y: 0 },

      player: { x: 0, y: 1 },
      "enemy.goblin": { x: 1, y: 1 },
      "enemy.troll": { x: 2, y: 1 },
      "enemy.ogre": { x: 3, y: 1 },
      "enemy.hell_houndin": { x: 4, y: 1 },

      // Optional decal frames (if present in atlas). Fallback drawing used otherwise.
      "decal.blood1": { x: 5, y: 1 },
      "decal.blood2": { x: 6, y: 1 },
      "decal.blood3": { x: 7, y: 1 },
    }
  });

  window.Tileset = Tileset;
})();