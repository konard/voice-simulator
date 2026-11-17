/** Compare function bodies to scope a recognition-only WASM change. Unlicense. */
import { readFileSync } from 'node:fs';

function functions(path) {
  const bytes = readFileSync(path);
  const imports = globalThis.WebAssembly.Module.imports(
    new globalThis.WebAssembly.Module(bytes)
  ).filter((item) => item.kind === 'function').length;
  let at = 8;
  const uint = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[at++];
      value += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    return value;
  };
  const exports = new Map();
  const bodies = new Map();
  while (at < bytes.length) {
    const section = bytes[at++];
    const end = uint() + at;
    if (section === 7) {
      const count = uint();
      for (let i = 0; i < count; i++) {
        const length = uint();
        const name = bytes.toString('utf8', at, at + length);
        at += length;
        const kind = bytes[at++];
        const index = uint();
        if (kind === 0) {
          exports.set(index, name);
        }
      }
    } else if (section === 10) {
      const count = uint();
      for (let i = 0; i < count; i++) {
        const length = uint();
        bodies.set(i + imports, bytes.subarray(at, at + length));
        at += length;
      }
    }
    at = end;
  }
  return { bodies, exports };
}
const [before, after] = process.argv.slice(2).map(functions);
const changed = [...after.bodies].filter(
  ([index, body]) => !body.equals(before.bodies.get(index) ?? Buffer.alloc(0))
);
console.log(
  JSON.stringify({
    before: before.bodies.size,
    after: after.bodies.size,
    changed: changed.map(([index]) => ({
      index,
      export: after.exports.get(index),
    })),
  })
);
