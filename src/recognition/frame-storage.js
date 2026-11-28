/** Scratch columns for synchronous acoustic analysis. Unlicense. */

const COLUMN_LIMIT = 1024 * 1024;
let spareColumns = new Map();

/** Consumers finish reading the columns before returning from `use`. */
export function withFrameStorage(use) {
  const columns = spareColumns ?? new Map();
  spareColumns = undefined;
  function storage(key, length, Type) {
    let column = columns.get(key);
    if (!(column instanceof Type) || column.length < length) {
      const capacity = column instanceof Type ? column.length : 0;
      const limit = COLUMN_LIMIT / Type.BYTES_PER_ELEMENT;
      const grown = Math.min(limit, Math.ceil(capacity * 1.5));
      column = new Type(Math.max(length, grown));
      if (length <= limit) {
        columns.set(key, column);
      }
    }
    return column.subarray(0, length);
  }
  try {
    return use(storage);
  } finally {
    spareColumns = columns;
  }
}
