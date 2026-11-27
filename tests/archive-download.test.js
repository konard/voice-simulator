import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import { BODYPARTS3D, fetchAnatomy } from '../scripts/fetch-anatomy.mjs';
import {
  ArchiveNetworkError,
  RangeRefusedError,
  fetchRange,
} from '../scripts/fetch-dvtd.mjs';
import { fetchJawReference } from './helpers/remote-anatomy.js';

const url = 'https://example.test/anatomy.zip';

describe('archive download cancellation', () => {
  it('bounds response body consumption and stops retries after cancellation', async () => {
    const controller = new AbortController();
    let requests = 0;
    const pending = fetchRange(url, 0, 1, {
      signal: controller.signal,
      delay: 0,
      fetcher: async (input, { signal }) => {
        requests++;
        expect(input).toBe(url);
        return {
          status: 206,
          arrayBuffer: () =>
            new Promise((resolve, reject) => {
              // Finite fallback also lets the regression fail on the old code.
              const timer = setTimeout(() => resolve(new ArrayBuffer(1)), 100);
              signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(signal.reason);
              });
            }),
        };
      },
    });
    const timer = setTimeout(() => controller.abort(new Error('deadline')), 10);
    try {
      await assert.rejects(
        pending,
        (error) =>
          error instanceof ArchiveNetworkError &&
          error.cause === controller.signal.reason
      );
      expect(requests).toBe(1);
    } finally {
      clearTimeout(timer);
    }
  });

  it('interrupts retry backoff when the whole download is cancelled', async () => {
    const controller = new AbortController();
    let requests = 0;
    const pending = fetchRange(url, 0, 1, {
      signal: controller.signal,
      attempts: 2,
      delay: 100,
      fetcher: async () => {
        requests++;
        return { status: 503 };
      },
    });
    const timer = setTimeout(() => controller.abort(), 10);
    try {
      await assert.rejects(pending);
      expect(requests).toBe(1);
    } finally {
      clearTimeout(timer);
    }
  });

  it('retries a dropped body while the download budget remains', async () => {
    let requests = 0;
    const bytes = await fetchRange(url, 0, 1, {
      delay: 0,
      fetcher: async () => ({
        status: 206,
        arrayBuffer: async () => {
          if (++requests === 1) {
            throw new TypeError('error reading a body from connection');
          }
          return new Uint8Array([7]).buffer;
        },
      }),
    });
    expect([...bytes]).toEqual([7]);
    expect(requests).toBe(2);
  });
});

describe('remote anatomy fixture preparation', () => {
  const probe = async () => null;

  it('uses the latest BodyParts3D archive size for the ZIP tail range', async () => {
    const output = mkdtempSync(join(tmpdir(), 'bodyparts3d-range-'));
    const archiveSize = 100_000;
    const tail = new Uint8Array(65_536);
    const directoryEnd = new DataView(tail.buffer, tail.length - 22);
    directoryEnd.setUint32(0, 0x06054b50, true);
    directoryEnd.setUint32(12, 1, true);
    directoryEnd.setUint32(16, archiveSize - 23, true);

    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, { method, headers }) => {
      expect(input).toBe(BODYPARTS3D.url);
      if (method === 'HEAD') {
        requests.push('HEAD');
        return new globalThis.Response(null, {
          headers: { 'Content-Length': archiveSize },
        });
      }
      requests.push(headers.Range);
      const directory = headers.Range === 'bytes=99977-99977';
      return new globalThis.Response(directory ? new Uint8Array(1) : tail, {
        status: 206,
      });
    };
    try {
      expect(await fetchAnatomy('bodyparts3d', output, { files: [] })).toEqual(
        []
      );
      expect(requests).toEqual([
        'HEAD',
        'bytes=34464-99999',
        'bytes=99977-99977',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(output, { recursive: true, force: true });
    }
  });

  it('reports cancellation while keeping unrelated errors visible', async () => {
    const controller = new AbortController();
    controller.abort(new Error('whole download deadline'));
    const cancelled = await fetchJawReference({
      probe,
      signal: controller.signal,
      download: async () => {
        throw controller.signal.reason;
      },
    });
    expect(cancelled.reason).toContain('whole download deadline');
    const corrupt = new Error('size or CRC-32 mismatch');
    const broken = await fetchJawReference({
      probe,
      signal: controller.signal,
      download: async () => {
        throw corrupt;
      },
    });
    expect(broken.error).toBe(corrupt);
    expect(broken.reason).toBe(undefined);
  });

  it('retains the measured reference and cleans temporary downloads', async () => {
    let directory;
    const signal = new AbortController().signal;
    const remote = await fetchJawReference({
      probe,
      signal,
      download: async (source, output, options) => {
        expect(source).toBe('open-full-jaw');
        expect(options.patients).toEqual([14]);
        expect(options.signal).toBe(signal);
        directory = output;
      },
      measure: () => ({ upper: { intercanine: 32 } }),
    });
    expect(remote).toEqual({ measured: { upper: { intercanine: 32 } } });
    expect(existsSync(directory)).toBe(false);
  });

  it('reports actual transport failures and range refusals as explicit skips', async () => {
    for (const error of [
      new ArchiveNetworkError(url, new TypeError('connection reset')),
      new RangeRefusedError(url, 503),
    ]) {
      const remote = await fetchJawReference({
        probe,
        download: async () => {
          throw error;
        },
      });
      expect(remote.reason).toContain(error.message);
      expect(remote.error).toBe(undefined);
    }
  });

  it('keeps corrupt archives and programming errors as test failures', async () => {
    for (const error of [
      new Error('size or CRC-32 mismatch'),
      new TypeError('invalid mesh'),
    ]) {
      const remote = await fetchJawReference({
        probe,
        download: async () => {
          throw error;
        },
      });
      expect(remote.error).toBe(error);
      expect(remote.reason).toBe(undefined);
    }
  });
});
