/** Optional recognition tables generated from the shipped lexicons. Unlicense. */
import { installLanguageModelReader } from './language-model.js';
import { installPreparedLexicons } from './lexicon.js';
import { openPreparedLexicon } from './prepared-lexicon.js';
import { HMM_MAX_WORDS, installPreparedHmm } from './hmm-network.js';
import { openHmmArchive } from './hmm-archive.js';
import { installPreparedModeBaselines } from './mode-baseline.js';
import {
  installWordTransitionReader,
  openWordTransitions,
} from './data/index.js';
import {
  installOralCodebookReader,
  openOralFeatureRows,
  oralTableCount,
  oralTableFile,
  oralTableMinLength,
  oralTableVersion,
} from './codebook-data.js';

export const recognitionModelVersion = 2;

export const recognitionDataFile = (kind) =>
  new globalThis.URL(
    `../engine/voice-simulator-recognition-${kind}.${kind === 'models' ? 'json' : 'bin'}.gz`,
    import.meta.url
  );

export const hmmNetworkVersion = 4;
const previousHmmArchiveVersion = 3;
const serializedHmmVersion = 2;
const hasSupplementalWords = (language, maxWords) =>
  language === 'en' && maxWords === HMM_MAX_WORDS;
export const hmmNetworkFile = (language, maxWords = HMM_MAX_WORDS) =>
  new globalThis.URL(
    `../engine/voice-simulator-hmm-${language}${maxWords === HMM_MAX_WORDS ? '' : `-${maxWords}`}.bin.gz`,
    import.meta.url
  );

export const wordTransitionVersion = 1;
export const wordTransitionFile = (language) =>
  new globalThis.URL(
    `../engine/voice-simulator-word-transitions-${language}.bin.gz`,
    import.meta.url
  );

export const modeBaselineVersion = 1;
export const modeBaselineFile = () =>
  new globalThis.URL(
    '../engine/voice-simulator-recognition-modes.bin.gz',
    import.meta.url
  );

let configured = false;

/** Counts are stored as sorted (index, count) pairs in one numeric array. */
function countAt(rows, index) {
  if (Number.isNaN(index)) {
    return 0;
  }
  let lo = 0;
  let hi = rows.length / 2;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (rows[mid * 2] < index) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return rows[lo * 2] === index ? rows[lo * 2 + 1] : 0;
}

export function openPackedLanguageModel([
  units,
  singles,
  pairs,
  triples,
  total,
]) {
  const ids = new Map(units.map((unit, index) => [unit, index]));
  const width = units.length;
  return {
    total,
    counts(a, b, c) {
      const first = ids.get(a);
      const previous = ids.get(b);
      const current = ids.get(c);
      const ab = first * width + previous;
      return [
        countAt(triples, ab * width + current),
        countAt(pairs, ab),
        countAt(pairs, previous * width + current),
        singles[previous],
        singles[current],
      ];
    },
  };
}

function packCounts(counts, ids) {
  const rows = [];
  const width = ids.size;
  for (const [key, count] of counts) {
    const index = key
      .split('\t')
      .reduce((previous, unit) => previous * width + ids.get(unit), 0);
    rows.push([index, count]);
  }
  return rows.sort(([a], [b]) => a - b).flat();
}

export function packLanguageModel({ singles, pairs, triples, total }) {
  const units = [...singles.keys()];
  const ids = new Map(units.map((unit, index) => [unit, index]));
  return [
    units,
    [...singles.values()],
    packCounts(pairs, ids),
    packCounts(triples, ids),
    total,
  ];
}

function configurePreparedHmm(readAsset, v8) {
  const hmmSizes = new Map();
  installPreparedHmm(
    (language, maxWords) => {
      try {
        const bytes = readAsset(hmmNetworkFile(language, maxWords));
        const archive = openHmmArchive(
          bytes,
          hmmNetworkVersion,
          v8.deserialize
        );
        if (archive) {
          return archive;
        }
        if (hasSupplementalWords(language, maxWords)) {
          return undefined;
        }
        const previous = openHmmArchive(
          bytes,
          previousHmmArchiveVersion,
          v8.deserialize
        );
        if (previous) {
          return previous;
        }
        const [version, network] = v8.deserialize(bytes);
        return version === serializedHmmVersion ? network : undefined;
      } catch {
        // Source installations can build the same network on demand.
      }
    },
    (language, maxWords) => {
      if (!hmmSizes.has(maxWords)) {
        hmmSizes.set(maxWords, {});
        try {
          const [version, sizes] = JSON.parse(
            readAsset(hmmNetworkFile('index', maxWords)).toString()
          );
          if (
            (version === hmmNetworkVersion ||
              version === previousHmmArchiveVersion ||
              version === serializedHmmVersion) &&
            typeof sizes === 'object' &&
            sizes
          ) {
            hmmSizes.set(maxWords, { version, sizes });
          }
        } catch {
          // Older installations grow the same columns as assets arrive.
        }
      }
      const { version, sizes } = hmmSizes.get(maxWords);
      if (
        version === hmmNetworkVersion ||
        !hasSupplementalWords(language, maxWords)
      ) {
        return sizes?.[language];
      }
    }
  );
}

export function configureNodeRecognitionModels() {
  if (configured) {
    return;
  }
  configured = true;
  const process = globalThis.process;
  const fs = process?.getBuiltinModule?.('node:fs');
  const zlib = process?.getBuiltinModule?.('node:zlib');
  if (!fs || !zlib) {
    return;
  }
  function readAsset(file) {
    const compressed = fs.readFileSync(file);
    // The packaged files have one gzip member. Its footer gives the output
    // length, so zlib can return one buffer without concatenating chunks.
    const length = compressed.readUInt32LE(compressed.length - 4);
    const chunkSize = Math.max(
      16 * 1024,
      Math.min(8 * 1024 * 1024, length + 1)
    );
    return zlib.gunzipSync(compressed, { chunkSize });
  }
  installWordTransitionReader((language, words) => {
    try {
      const bytes = readAsset(wordTransitionFile(language));
      const header = 2 * Uint32Array.BYTES_PER_ELEMENT;
      if (process.getBuiltinModule('node:os').endianness() === 'BE') {
        return undefined;
      }
      if (bytes.readUInt32LE(0) !== wordTransitionVersion) {
        return undefined;
      }
      const length = bytes.readUInt32LE(4);
      if (length !== words.length + 1) {
        return undefined;
      }
      const data = new Uint32Array(
        bytes.buffer,
        bytes.byteOffset + header,
        (bytes.length - header) / Uint32Array.BYTES_PER_ELEMENT
      );
      return openWordTransitions(
        words,
        data.subarray(0, length),
        data.subarray(length)
      );
    } catch {
      // Source installations can index the same transitions on demand.
    }
  });
  let oralArchive;
  installOralCodebookReader((length) => {
    const index = 2 * (length - oralTableMinLength);
    if (!Number.isInteger(index) || index < 0 || index >= oralTableCount) {
      return undefined;
    }
    try {
      oralArchive ??= fs.readFileSync(oralTableFile());
      if (oralArchive.readUInt32LE(0) !== oralTableVersion) {
        return undefined;
      }
      const start = oralArchive.readUInt32LE(4 * (index + 1));
      const end = oralArchive.readUInt32LE(4 * (index + 2));
      return openOralFeatureRows(
        zlib.gunzipSync(oralArchive.subarray(start, end))
      );
    } catch {
      return undefined;
    }
  });
  function read(kind) {
    const bytes = readAsset(recognitionDataFile(kind));
    const [version, rows] =
      kind === 'models' ? JSON.parse(bytes.toString()) : v8.deserialize(bytes);
    return version === recognitionModelVersion ? rows : undefined;
  }
  const v8 = process.getBuiltinModule('node:v8');
  let modeBaselines;
  installPreparedModeBaselines((key) => {
    if (!modeBaselines) {
      modeBaselines = new Map();
      try {
        const [version, rows] = v8.deserialize(readAsset(modeBaselineFile()));
        if (version === modeBaselineVersion && rows instanceof Map) {
          modeBaselines = rows;
        }
      } catch {
        // Source installations can measure these references on demand.
      }
    }
    const row = modeBaselines.get(key);
    return row && globalThis.structuredClone(row);
  });
  configurePreparedHmm(readAsset, v8);
  installPreparedLexicons((language, words) => {
    try {
      const rows = read(language);
      if (rows) {
        return openPreparedLexicon(rows, language, words);
      }
    } catch {
      // Source installations can build the same trie on demand.
    }
  });
  installLanguageModelReader(() => {
    try {
      const rows = read('models');
      return new Map(
        rows?.map(([language, model]) => [
          language,
          openPackedLanguageModel(model),
        ])
      );
    } catch {
      // Source installations can count the same pronunciations on demand.
    }
  });
}
