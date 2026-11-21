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
    const view = (size = length) =>
      new Type(module.memory.buffer, pointer, size);
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
