#!/usr/bin/env node
// Fetch single files of the Dresden Vocal Tract Dataset (Birkholz et al.
// 2020, Scientific Data 7, 255; CC0 on figshare, article 11897187) without
// downloading the whole 1.1 GB archive: the zip central directory is read
// with HTTP range requests, then only the wanted members are fetched,
// inflated and checked against their CRC-32.
//
// Usage: node scripts/fetch-dvtd.mjs <output directory> <name pattern>...
//   e.g. node scripts/fetch-dvtd.mjs /tmp/dvtd '*s2-01-*inner-surface.stl'
//   A pattern matches whole member paths; `*` stands for any text.
//   With --list, only print the matching members and their sizes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';

export const DVTD_ARCHIVE = 'https://www.vocaltractlab.de/dvtd.zip';
export const DVTD_ARCHIVE_SIZE = 1129467424;

/** Tries per range request: the server sometimes refuses a valid range. */
const RANGE_ATTEMPTS = 4;
/** Wait before the next try (ms), multiplied by the number of tries so far. */
const RANGE_RETRY_DELAY = 2000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rangeOnce(url, start, end, fetcher) {
  const response = await fetcher(url, {
    headers: { Range: `bytes=${start}-${end - 1}` },
  });
  if (response.status !== 206) {
    throw new Error(`${url}: range request answered ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Bytes [start, end) of a remote file, tried again on a refused range or a
 * network error.
 * @param {string} url
 * @param {number} start
 * @param {number} end
 * @param {{attempts?: number, delay?: number, fetcher?: typeof fetch}} [options]
 * @returns {Promise<Buffer>}
 */
export async function fetchRange(
  url,
  start,
  end,
  {
    attempts = RANGE_ATTEMPTS,
    delay = RANGE_RETRY_DELAY,
    fetcher = globalThis.fetch,
  } = {}
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rangeOnce(url, start, end, fetcher);
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      await wait(delay * attempt);
    }
  }
}

const range = (url, start, end) => fetchRange(url, start, end);

/** End of central directory: offset and size of the directory. */
function directoryLocation(tail, tailStart) {
  const zip64 = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
  if (zip64 >= 0) {
    return {
      size: Number(tail.readBigUInt64LE(zip64 + 40)),
      offset: Number(tail.readBigUInt64LE(zip64 + 48)),
    };
  }
  const end = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) {
    throw new Error(`no end of central directory near ${tailStart}`);
  }
  return {
    size: tail.readUInt32LE(end + 12),
    offset: tail.readUInt32LE(end + 16),
  };
}

/** Sizes and offset of an entry, from its zip64 extra field when needed. */
function zip64Values(extra, entry) {
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at);
    const length = extra.readUInt16LE(at + 2);
    if (id === 1) {
      let field = at + 4;
      for (const key of ['size', 'compressedSize', 'offset']) {
        if (entry[key] === 0xffffffff) {
          entry[key] = Number(extra.readBigUInt64LE(field));
          field += 8;
        }
      }
    }
    at += 4 + length;
  }
  return entry;
}

/**
 * Members of a remote zip archive.
 * @param {string} [url]
 * @param {number} [archiveSize]
 * @returns {Promise<{name: string, method: number, crc: number,
 *   compressedSize: number, size: number, offset: number}[]>}
 */
export async function listMembers(
  url = DVTD_ARCHIVE,
  archiveSize = DVTD_ARCHIVE_SIZE
) {
  const tailStart = archiveSize - 65536;
  const tail = await range(url, tailStart, archiveSize);
  const location = directoryLocation(tail, tailStart);
  const directory = await range(
    url,
    location.offset,
    location.offset + location.size
  );
  const members = [];
  let at = 0;
  while (
    at + 46 <= directory.length &&
    directory.readUInt32LE(at) === 0x02014b50
  ) {
    const nameLength = directory.readUInt16LE(at + 28);
    const extraLength = directory.readUInt16LE(at + 30);
    const commentLength = directory.readUInt16LE(at + 32);
    const name = directory.toString('utf8', at + 46, at + 46 + nameLength);
    const extra = directory.subarray(
      at + 46 + nameLength,
      at + 46 + nameLength + extraLength
    );
    members.push(
      zip64Values(extra, {
        name,
        method: directory.readUInt16LE(at + 10),
        crc: directory.readUInt32LE(at + 16),
        compressedSize: directory.readUInt32LE(at + 20),
        size: directory.readUInt32LE(at + 24),
        offset: directory.readUInt32LE(at + 42),
      })
    );
    at += 46 + nameLength + extraLength + commentLength;
  }
  return members;
}

/**
 * Bytes of one member, checked against its size and CRC-32.
 * @param {{name: string, method: number, crc: number, compressedSize: number,
 *   size: number, offset: number}} member
 * @param {string} [url]
 */
export async function fetchMember(member, url = DVTD_ARCHIVE) {
  const header = await range(url, member.offset, member.offset + 30);
  const start =
    member.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const packed = await range(url, start, start + member.compressedSize);
  const data = member.method === 8 ? inflateRawSync(packed) : packed;
  if (data.length !== member.size || crc32(data) !== member.crc) {
    throw new Error(`${member.name}: size or CRC-32 mismatch`);
  }
  return data;
}

/**
 * Whether a member path matches a pattern in which `*` stands for any
 * text (plain string matching: patterns come from the command line).
 * @param {string} pattern
 * @param {string} name
 */
export function matchesPattern(pattern, name) {
  const parts = pattern.split('*');
  const first = parts[0];
  const last = parts.at(-1);
  if (parts.length === 1) {
    return name === pattern;
  }
  if (!name.startsWith(first) || !name.endsWith(last)) {
    return false;
  }
  let from = first.length;
  const end = name.length - last.length;
  for (const part of parts.slice(1, -1)) {
    const at = name.indexOf(part, from);
    if (at < 0 || at + part.length > end) {
      return false;
    }
    from = at + part.length;
  }
  return from <= end;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = process.argv.includes('--list');
  const [output, ...patterns] = process.argv
    .slice(2)
    .filter((value) => value !== '--list');
  const members = (await listMembers()).filter((member) =>
    patterns.some((pattern) => matchesPattern(pattern, member.name))
  );
  if (!list) {
    mkdirSync(output, { recursive: true });
  }
  for (const member of members) {
    console.log(`${member.name} ${member.size}`);
    if (!list) {
      writeFileSync(
        join(output, basename(member.name)),
        await fetchMember(member)
      );
    }
  }
}
