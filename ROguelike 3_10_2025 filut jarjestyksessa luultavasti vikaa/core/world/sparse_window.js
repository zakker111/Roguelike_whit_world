import { CHUNK_SIZE, chunkCoord, chunkKey } from "./chunk_cache.js";

const UNSET = Symbol("unset");
const NUMERIC_KEY_RE = /^(0|[1-9]\d*)$/;

class SparseChunkStore {
  constructor({ defaultValue = null, fallbackGet = null, typed = false } = {}) {
    this._chunks = new Map();
    this._defaultValue = defaultValue;
    this._fallbackGet = typeof fallbackGet === "function" ? fallbackGet : null;
    this._typed = !!typed;
  }

  _createChunk() {
    const size = CHUNK_SIZE * CHUNK_SIZE;
    if (this._typed && typeof Uint8Array !== "undefined") {
      return new Uint8Array(size);
    }
    return new Array(size).fill(UNSET);
  }

  _index(x, y) {
    const cx = chunkCoord(x);
    const cy = chunkCoord(y);
    const lx = (x | 0) - cx * CHUNK_SIZE;
    const ly = (y | 0) - cy * CHUNK_SIZE;
    return {
      key: chunkKey(cx, cy),
      offset: ly * CHUNK_SIZE + lx
    };
  }

  get(x, y) {
    const ref = this._index(x, y);
    const chunk = this._chunks.get(ref.key);
    if (!chunk) {
      return this._fallbackGet ? this._fallbackGet(x | 0, y | 0) : this._defaultValue;
    }
    const value = chunk[ref.offset];
    if (!this._typed && value === UNSET) {
      return this._fallbackGet ? this._fallbackGet(x | 0, y | 0) : this._defaultValue;
    }
    return value;
  }

  set(x, y, value) {
    const ref = this._index(x, y);
    let chunk = this._chunks.get(ref.key);
    if (!chunk) {
      chunk = this._createChunk();
      this._chunks.set(ref.key, chunk);
    }
    if (this._typed) {
      chunk[ref.offset] = value ? 1 : 0;
    } else {
      chunk[ref.offset] = value;
    }
  }
}

function makeSparseRow(store, refs, localY, supportsFill) {
  const rowTarget = [];
  let proxy = null;

  proxy = new Proxy(rowTarget, {
    get(target, prop, receiver) {
      if (prop === "length") return refs.width | 0;
      if (prop === Symbol.iterator) {
        return function* () {
          const width = refs.width | 0;
          const ay = (refs.originY | 0) + (localY | 0);
          for (let x = 0; x < width; x++) {
            yield store.get((refs.originX | 0) + x, ay);
          }
        };
      }
      if (supportsFill && prop === "fill") {
        return (value, start = 0, end = refs.width) => {
          const width = refs.width | 0;
          const ay = (refs.originY | 0) + (localY | 0);
          const from = Math.max(0, start | 0);
          const to = Math.max(from, Math.min(width, end == null ? width : end | 0));
          for (let x = from; x < to; x++) {
            store.set((refs.originX | 0) + x, ay, value);
          }
          return proxy;
        };
      }
      if (typeof prop === "string" && NUMERIC_KEY_RE.test(prop)) {
        const x = prop | 0;
        if (x < 0 || x >= (refs.width | 0)) return undefined;
        return store.get((refs.originX | 0) + x, (refs.originY | 0) + (localY | 0));
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      if (typeof prop === "string" && NUMERIC_KEY_RE.test(prop)) {
        const x = prop | 0;
        if (x < 0 || x >= (refs.width | 0)) return true;
        store.set((refs.originX | 0) + x, (refs.originY | 0) + (localY | 0), value);
        return true;
      }
      return Reflect.set(target, prop, value, receiver);
    },
    has(target, prop) {
      if (prop === "length") return true;
      if (typeof prop === "string" && NUMERIC_KEY_RE.test(prop)) {
        const x = prop | 0;
        return x >= 0 && x < (refs.width | 0);
      }
      return Reflect.has(target, prop);
    }
  });

  return proxy;
}

export function createSparseMatrix(store, refs, { supportsFill = false } = {}) {
  const target = [];
  const rowCache = new Map();

  function rowAt(y) {
    if (!rowCache.has(y)) {
      rowCache.set(y, makeSparseRow(store, refs, y, supportsFill));
    }
    return rowCache.get(y);
  }

  return new Proxy(target, {
    get(base, prop, receiver) {
      if (prop === "length") return refs.height | 0;
      if (prop === Symbol.iterator) {
        return function* () {
          const height = refs.height | 0;
          for (let y = 0; y < height; y++) yield rowAt(y);
        };
      }
      if (typeof prop === "string" && NUMERIC_KEY_RE.test(prop)) {
        const y = prop | 0;
        if (y < 0 || y >= (refs.height | 0)) return undefined;
        return rowAt(y);
      }
      return Reflect.get(base, prop, receiver);
    },
    set(base, prop, value, receiver) {
      if (typeof prop === "string" && NUMERIC_KEY_RE.test(prop)) {
        const y = prop | 0;
        if (y < 0 || y >= (refs.height | 0) || !value || typeof value.length !== "number") return true;
        const width = Math.min(refs.width | 0, value.length | 0);
        for (let x = 0; x < width; x++) {
          store.set((refs.originX | 0) + x, (refs.originY | 0) + y, value[x]);
        }
        return true;
      }
      return Reflect.set(base, prop, value, receiver);
    },
    has(base, prop) {
      if (prop === "length") return true;
      if (typeof prop === "string" && NUMERIC_KEY_RE.test(prop)) {
        const y = prop | 0;
        return y >= 0 && y < (refs.height | 0);
      }
      return Reflect.has(base, prop);
    }
  });
}

export function createSparseTileStore(gen) {
  return new SparseChunkStore({
    defaultValue: null,
    fallbackGet: (x, y) => gen.tileAt(x, y),
    typed: false
  });
}

export function createSparseFogStore() {
  return new SparseChunkStore({
    defaultValue: 0,
    typed: true
  });
}
