/** Aligned numeric columns of a prepared HMM network. Unlicense. */

const TYPES = [Uint8Array, Uint16Array, Uint32Array, Float64Array];
const HEADER_BYTES = 8;
const LITTLE_ENDIAN = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;
const align = (value, width) => Math.ceil(value / width) * width;

function mapColumns(network, transform) {
  const entries = (columns) =>
    Object.fromEntries(
      Object.entries(columns).map(([name, column]) => [name, transform(column)])
    );
  const { symbols, ...words } = network.words;
  return {
    nodes: entries(network.nodes),
    tree: network.tree,
    emit: transform(network.emit),
    wordId: transform(network.wordId),
    nextWord: transform(network.nextWord),
    words: { ...entries(words), symbols },
  };
}

/** Store the version in the same byte order as the numeric columns. */
export function packHmmArchive(network, version, serialize) {
  let columnsBytes = 0;
  const columns = [];
  const metadata = mapColumns(network, (column) => {
    const kind = TYPES.indexOf(column.constructor);
    if (kind < 0) {
      throw new TypeError('Unsupported HMM archive column type');
    }
    const offset = align(columnsBytes, column.BYTES_PER_ELEMENT);
    const source = new Uint8Array(
      column.buffer,
      column.byteOffset,
      column.byteLength
    );
    columns.push({ offset, source });
    columnsBytes = offset + source.length;
    return [kind, offset, column.length];
  });
  const descriptors = serialize(metadata);
  const start = align(HEADER_BYTES + descriptors.length, 8);
  const output = new Uint8Array(start + columnsBytes);
  const header = new DataView(output.buffer);
  header.setUint32(0, version, LITTLE_ENDIAN);
  header.setUint32(4, descriptors.length, true);
  output.set(descriptors, HEADER_BYTES);
  for (const { offset, source } of columns) {
    output.set(source, start + offset);
  }
  return output;
}

/** Open views of the inflated file without copying the numeric columns. */
export function openHmmArchive(bytes, version, deserialize) {
  const { buffer, byteOffset, byteLength } = bytes;
  const header = new DataView(buffer, byteOffset, byteLength);
  if (header.getUint32(0, LITTLE_ENDIAN) !== version) {
    return undefined;
  }
  const end = HEADER_BYTES + header.getUint32(4, true);
  const start = align(end, 8);
  if (start > byteLength) {
    throw new RangeError('Invalid HMM archive metadata size');
  }
  const metadata = deserialize(bytes.subarray(HEADER_BYTES, end));
  return mapColumns(metadata, ([kind, offset, length]) => {
    const Type = TYPES[kind];
    if (
      !Type ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      start + offset + length * Type.BYTES_PER_ELEMENT > byteLength
    ) {
      throw new RangeError('Invalid HMM archive column');
    }
    return new Type(buffer, byteOffset + start + offset, length);
  });
}
