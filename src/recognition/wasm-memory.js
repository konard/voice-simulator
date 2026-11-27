/** Explicit ownership of recognition buffers in the engine's linear memory. Unlicense. */
export function withWasmMemory(module, run) {
  const { vs_alloc: allocate, vs_free: free } = module.exports;
  const allocations = [];
  function array(Type, length, source) {
    const bytes = length * Type.BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 0x7fffffff) {
      throw new RangeError('Recognition buffer exceeds WebAssembly limits');
    }
    const pointer = allocate(bytes);
    if (!pointer) {
      throw new RangeError('Cannot allocate recognition buffer');
    }
    allocations.push([pointer, bytes]);
    let full;
    const view = (size = length) => {
      const buffer = module.memory.buffer;
      if (size !== length) {
        return new Type(buffer, pointer, size);
      }
      // Memory growth detaches the old buffer and its views.
      if (full?.buffer !== buffer) {
        full = new Type(buffer, pointer, length);
      }
      return full;
    };
    if (source) {
      view().set(source);
    }
    return { pointer, length, view };
  }
  try {
    return run(array);
  } finally {
    for (const [pointer, bytes] of allocations) {
      free(pointer, bytes);
    }
  }
}
