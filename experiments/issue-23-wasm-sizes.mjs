/**
 * Issue 23: the largest functions of a WebAssembly file built with names
 * (CARGO_PROFILE_RELEASE_STRIP=false), to see what the size budget pays for.
 *
 *   node experiments/issue-23-wasm-sizes.mjs <file.wasm> [count]
 */
import { readFileSync } from 'node:fs';

const bytes = readFileSync(process.argv[2]);
const count = Number(process.argv[3] ?? 30);
let offset = 8;
function leb() {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = bytes[offset++];
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (byte < 0x80) {
      return result;
    }
  }
}
/** The function names of a `name` custom section ending at `end`. */
function readNames(end) {
  while (offset < end) {
    const sub = bytes[offset++];
    const subEnd = offset + leb();
    const n = sub === 1 ? leb() : 0;
    for (let i = 0; i < n; i++) {
      const index = leb();
      const length = leb();
      names.set(index, bytes.subarray(offset, offset + length).toString());
      offset += length;
    }
    offset = subEnd;
  }
}
let imports = 0;
const sizes = [];
const names = new Map();
while (offset < bytes.length) {
  const id = bytes[offset++];
  const size = leb();
  const end = offset + size;
  if (id === 2) {
    const n = leb();
    for (let i = 0; i < n; i++) {
      offset += leb();
      offset += leb();
      const kind = bytes[offset++];
      if (kind === 0) {
        leb();
        imports++;
      } else {
        throw new Error('only function imports handled');
      }
    }
  } else if (id === 10) {
    const n = leb();
    for (let i = 0; i < n; i++) {
      const body = leb();
      sizes.push(body);
      offset += body;
    }
  } else if (id === 0) {
    const nameLength = leb();
    const name = bytes.subarray(offset, offset + nameLength).toString();
    offset += nameLength;
    if (name === 'name') {
      readNames(end);
    }
  }
  offset = end;
}
const rows = sizes.map((size, i) => [size, names.get(i + imports) ?? `#${i}`]);
rows.sort((a, b) => b[0] - a[0]);
console.log(
  `file ${bytes.length} bytes, code ${sizes.reduce((a, b) => a + b, 0)} bytes in ${sizes.length} functions`
);
for (const [size, name] of rows.slice(0, count)) {
  console.log(String(size).padStart(7), name.slice(0, 150));
}
