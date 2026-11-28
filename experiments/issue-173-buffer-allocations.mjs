/** Attribute large typed array allocations in an opt-in memory probe. Unlicense. */
const MIN_BYTES = 32 * 1024;

function sampleBuffers() {
  const sites = new Map();
  const types = [
    'Uint8Array',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'Float32Array',
    'Float64Array',
  ];
  for (const name of types) {
    const PlainArray = globalThis[name];
    const instrumented = new Proxy(PlainArray, {
      construct(target, args, newTarget) {
        const array = Reflect.construct(
          target,
          args,
          newTarget === instrumented ? target : newTarget
        );
        const { byteLength } = array;
        if (
          byteLength >= MIN_BYTES &&
          !(args[0] instanceof ArrayBuffer) &&
          !(args[0] instanceof SharedArrayBuffer)
        ) {
          const site = new Error().stack.split('\n', 4).slice(2).join(' ');
          if (!sites.has(site)) {
            sites.set(site, { bytes: 0, count: 0, max: 0 });
          }
          const row = sites.get(site);
          row.bytes += byteLength;
          row.count++;
          row.max = Math.max(row.max, byteLength);
        }
        return array;
      },
    });
    globalThis[name] = instrumented;
  }
  process.on('exit', () => {
    const mib = (bytes) => (bytes / 1024 ** 2).toFixed(2);
    const largest = [...sites]
      .sort(([, a], [, b]) => b.bytes - a.bytes)
      .slice(0, 30);
    for (const [site, { bytes, count, max }] of largest) {
      console.log(`${mib(bytes)} MiB in ${count}, max ${mib(max)} MiB ${site}`);
    }
  });
}

// Constructor instrumentation affects timing and cannot certify peak RSS.
if (process.env.VOICE_MEMORY_BUFFERS === '1') {
  sampleBuffers();
}
