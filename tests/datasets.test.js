/**
 * Tests for scripts/datasets.mjs (issue 16): the speech dataset registry,
 * the licence gate and the downloader. Downloads are served by a node:http
 * server on 127.0.0.1 that the test starts, so nothing leaves the machine.
 */

import { describe, expect, it } from 'test-anywhere';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import {
  downloadFile,
  entryUrls,
  EXIT,
  fetchDataset,
  joinTexts,
  licenceGate,
  loadPolicy,
  loadRefused,
  loadRegistry,
  readDataset,
  validateRegistry,
} from '../scripts/datasets.mjs';
import { itUnless, sandboxed } from './helpers/skip.js';

const run = itUnless(sandboxed);

const POLICY = {
  allowedDatasetLicences: [
    'Public-Domain',
    'CC0-1.0',
    'CC-BY-4.0',
    'CC-BY-3.0',
    'Apache-2.0',
    'MIT',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'Custom-Attribution',
  ],
};

/** A date in the YYYY-MM-DD form the registry wants. */
const CHECKED = new Date(Date.UTC(2026, 10, 15)).toISOString().slice(0, 10);

const hex = (data) => createHash('sha256').update(data).digest('hex');

/** Bytes 0..255 repeated: a body whose every range is easy to check. */
const body = (length) => Buffer.from({ length }, (_, at) => at % 256);

/** A valid files entry; each case of "rejects bad entries" breaks one field. */
function filesEntry(overrides = {}) {
  return {
    id: 'sample',
    title: 'A sample',
    languages: ['en'],
    licence: 'Public-Domain',
    licenceUrl: 'https://example.org/licence',
    licenceQuote: 'This recording is in the public domain.',
    licenceChecked: CHECKED,
    redistribution: true,
    citation: 'Nobody (2026).',
    source: {
      kind: 'files',
      files: [
        {
          name: 'sample.mp3',
          url: 'https://example.org/sample.mp3',
          size: 10,
          sha256: 'a'.repeat(64),
        },
      ],
    },
    ...overrides,
  };
}

/** The error a promise rejects with; fails when it resolves. */
async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

/** Starts `handler` on 127.0.0.1; `fn` gets the base URL and the requests. */
async function withServer(handler, fn) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers });
    handler(request, response, requests.length);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(path.join(tmpdir(), 'datasets-'));
  try {
    return await fn({ base, dir, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A mono 16-bit WAV file of `samples` samples at 16 kHz. */
function wav(samples, seed) {
  const data = Buffer.alloc(samples * 2);
  for (let at = 0; at < samples; at += 1) {
    data.writeInt16LE(((at * 37 + seed * 101) % 2000) - 1000, at * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe('speech dataset registry', () => {
  run('registry is valid', () => {
    const registry = loadRegistry();
    const refused = loadRefused();
    expect(validateRegistry(registry, loadPolicy(), refused)).toEqual([]);
    expect(registry.datasets.length).toBeGreaterThan(0);
    const urls = registry.datasets.flatMap((entry) => entryUrls(entry));
    for (const item of refused) {
      expect(urls.filter((url) => url.startsWith(item.url))).toEqual([]);
    }
  });

  describe('rejects bad entries', () => {
    const cases = [
      [
        'a missing field',
        { citation: undefined },
        'sample: missing field citation',
      ],
      [
        'a bad id',
        { id: 'Bad_Id' },
        'Bad_Id: bad id; use lower case letters, digits and -',
      ],
      [
        'an unknown language',
        { languages: ['de'] },
        'sample: unknown language "de"; use en, ru, hi, zh',
      ],
      [
        'a URL that is not https://',
        { licenceUrl: 'http://example.org/licence' },
        'sample: licenceUrl "http://example.org/licence" is not https://',
      ],
      [
        'a refused licence',
        { licence: 'CC-BY-NC-4.0', redistribution: false },
        'sample: licence refused: "CC-BY-NC-4.0" is not in allowedDatasetLicences of scripts/policy-denylist.json',
      ],
      [
        'redistribution with a licence other than Public-Domain or CC0-1.0',
        { licence: 'CC-BY-4.0' },
        'sample: redistribution is true but the licence is "CC-BY-4.0"; only Public-Domain or CC0-1.0 may be committed',
      ],
    ];
    for (const [name, overrides, message] of cases) {
      it(`rejects ${name}`, () => {
        const registry = { schema: 1, datasets: [filesEntry(overrides)] };
        expect(validateRegistry(registry, POLICY)).toEqual([message]);
      });
    }

    it('rejects a duplicate id', () => {
      const registry = { schema: 1, datasets: [filesEntry(), filesEntry()] };
      expect(validateRegistry(registry, POLICY)).toEqual([
        'sample: duplicate id',
      ]);
    });

    it('rejects a null checksum', () => {
      const entry = filesEntry();
      entry.source.files[0].sha256 = null;
      const rows = filesEntry({
        id: 'rows',
        redistribution: false,
        licence: 'CC-BY-4.0',
        source: {
          kind: 'rows',
          dataset: 'google/fleurs',
          config: 'ru_ru',
          split: 'validation',
          length: 3,
          textColumn: 'raw_transcription',
          textSha256: null,
        },
      });
      expect(
        validateRegistry({ schema: 1, datasets: [entry, rows] }, POLICY)
      ).toEqual([
        'sample: source.files[0]: sha256 is null; run fetch --record',
        'rows: source.textSha256 is null; run fetch --record',
      ]);
    });

    it('rejects a URL of datasets/refused.json', () => {
      const refused = [
        {
          title: 'A refused corpus',
          licence: 'LicenseRef-Paid',
          reason: 'paid agreement',
          url: 'https://example.org',
        },
      ];
      const problems = validateRegistry(
        { schema: 1, datasets: [filesEntry()] },
        POLICY,
        refused
      );
      expect(problems.length).toBe(2);
      expect(problems[0]).toMatch(/^sample: https:\/\/example\.org\/sample/);
      expect(problems[0]).toMatch(/refuses \(paid agreement\)$/);
    });
  });

  it('licence gate', () => {
    for (const licence of ['CC-BY-4.0', 'Public-Domain']) {
      expect(licenceGate({ licence }, POLICY)).toBe(null);
    }
    for (const licence of [
      'CC-BY-NC-4.0',
      'CC-BY-SA-4.0',
      'CC-BY-NC-ND-4.0',
      'GPL-3.0-only',
      '',
    ]) {
      expect(typeof licenceGate({ licence }, POLICY)).toBe('string');
    }
    // No policy, no licences: the gate fails closed.
    expect(typeof licenceGate({ licence: 'CC0-1.0' }, {})).toBe('string');
  });
});

describe('speech dataset downloads', () => {
  const data = body(100000);
  const serveData = (request, response) => {
    const range = /^bytes=(\d+)-$/.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0;
    const part = data.subarray(start);
    response.writeHead(range ? 206 : 200, {
      'Content-Length': String(part.length),
    });
    response.end(part);
  };

  run('downloads and verifies', () =>
    withServer(serveData, async ({ base, dir, requests }) => {
      const target = path.join(dir, 'data.bin');
      const result = await downloadFile(`${base}/data.bin`, target, {
        size: data.length,
        sha256: hex(data),
      });
      expect(result.status).toBe('downloaded');
      expect(result.size).toBe(100000);
      expect(result.sha256).toBe(hex(data));
      expect(hex(readFileSync(target))).toBe(hex(data));
      expect(requests[0].headers['user-agent']).toBe(
        'voice-simulator-datasets'
      );
      const again = await downloadFile(`${base}/data.bin`, target, {
        size: data.length,
        sha256: hex(data),
      });
      expect(again.status).toBe('cached');
      expect(requests.length).toBe(1);
    })
  );

  run('resumes', () =>
    withServer(serveData, async ({ base, dir, requests }) => {
      const target = path.join(dir, 'data.bin');
      writeFileSync(`${target}.part`, data.subarray(0, 40000));
      const sent = [];
      const result = await downloadFile(`${base}/data.bin`, target, {
        size: data.length,
        sha256: hex(data),
        fetcher: async (url, init) => {
          const response = await fetch(url, init);
          sent.push(Number(response.headers.get('content-length')));
          return response;
        },
      });
      expect(requests.map((item) => item.headers.range)).toEqual([
        'bytes=40000-',
      ]);
      expect(sent).toEqual([60000]);
      expect(result.status).toBe('resumed');
      expect(hex(readFileSync(target))).toBe(hex(data));
      expect(existsSync(`${target}.part`)).toBe(false);
    })
  );

  run('detects a wrong checksum', () =>
    withServer(serveData, async ({ base, dir }) => {
      const target = path.join(dir, 'data.bin');
      const error = await failure(
        downloadFile(`${base}/data.bin`, target, {
          size: data.length,
          sha256: 'b'.repeat(64),
        })
      );
      expect(error.code).toBe(EXIT.checksum);
      expect(readdirSync(dir)).toEqual([]);
    })
  );

  run('retries', () =>
    withServer(
      (request, response, count) => {
        if (count <= 2) {
          response.writeHead(503);
          response.end();
          return;
        }
        serveData(request, response);
      },
      async ({ base, dir, requests }) => {
        const target = path.join(dir, 'data.bin');
        const result = await downloadFile(`${base}/data.bin`, target, {
          size: data.length,
          sha256: hex(data),
          delay: 1,
        });
        expect(result.sha256).toBe(hex(data));
        expect(requests.length).toBe(3);
      }
    )
  );

  run('refuses a download larger than maxBytes', () =>
    withServer(serveData, async ({ base, dir }) => {
      const target = path.join(dir, 'data.bin');
      const error = await failure(
        downloadFile(`${base}/data.bin`, target, {
          size: data.length,
          sha256: hex(data),
          maxBytes: 50000,
        })
      );
      expect(error.code).toBe(EXIT.tooLarge);
      expect(existsSync(target)).toBe(false);
    })
  );
});

describe('speech dataset rows', () => {
  run('fetches rows', () => {
    const audio = [wav(800, 1), wav(1200, 2), wav(1000, 3)];
    let texts = ['Первая фраза.', 'Вторая фраза.', 'Третья фраза.'];
    return withServer(
      (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const base = `http://${request.headers.host}`;
        if (url.pathname === '/rows') {
          const rows = texts.map((text, at) => ({
            row_idx: at,
            row: {
              raw_transcription: text,
              gender: at % 2,
              audio: [{ src: `${base}/audio/${at}.wav?Expires=1` }],
            },
            truncated_cells: [],
          }));
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ rows, num_rows_total: 3 }));
          return;
        }
        const match = /^\/audio\/(\d)\.wav$/.exec(url.pathname);
        const file = match ? audio[Number(match[1])] : undefined;
        response.writeHead(file ? 200 : 404);
        response.end(file);
      },
      async ({ base, dir, requests }) => {
        const entry = filesEntry({
          id: 'rows-sample',
          licence: 'CC-BY-4.0',
          redistribution: false,
          source: {
            kind: 'rows',
            dataset: 'google/fleurs',
            config: 'ru_ru',
            split: 'validation',
            length: 3,
            textColumn: 'raw_transcription',
            textSha256: hex(joinTexts(texts)),
          },
        });
        const registry = { schema: 1, datasets: [entry] };
        const options = {
          registry,
          cache: path.join(dir, 'cache'),
          endpoint: `${base}/rows`,
          delay: 1,
        };
        const result = await fetchDataset('rows-sample', options);
        expect(result.files.map((file) => file.status)).toEqual([
          'downloaded',
          'downloaded',
          'downloaded',
        ]);
        const rowsJson = JSON.parse(
          readFileSync(path.join(result.dir, 'rows.json'), 'utf8')
        );
        expect(rowsJson.length).toBe(3);
        expect(rowsJson[1]).toEqual({
          index: 1,
          text: 'Вторая фраза.',
          gender: 'female',
          audio: 'audio/000001.wav',
          sha256: hex(audio[1]),
        });
        expect(
          readFileSync(path.join(result.dir, 'ATTRIBUTION.txt'), 'utf8')
        ).toMatch(/Licence: CC-BY-4\.0/);

        const items = readDataset('rows-sample', options);
        expect(items.length).toBe(3);
        for (const item of items) {
          expect(existsSync(item.audioPath)).toBe(true);
        }
        expect(items[0].id).toBe('rows-sample/000000');
        expect(items[0].text).toBe('Первая фраза.');

        const before = requests.length;
        const again = await fetchDataset('rows-sample', options);
        expect(again.files.map((file) => file.status)).toEqual([
          'cached',
          'cached',
          'cached',
        ]);
        expect(requests.length).toBe(before);

        texts = ['Первая фраза.', 'Другая фраза.', 'Третья фраза.'];
        const fresh = { ...options, cache: path.join(dir, 'fresh') };
        mkdirSync(fresh.cache);
        const error = await failure(fetchDataset('rows-sample', fresh));
        expect(error.code).toBe(EXIT.checksum);
        expect(error.message).toMatch(/the dataset changed/);
      }
    );
  });
});
