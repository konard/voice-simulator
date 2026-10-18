/**
 * HTTP API: JSON endpoints, audio synthesis in every format and streaming.
 */

import { describe, expect, it } from 'test-anywhere';
import { decodeAudio, decodeWav } from '../src/index.js';
import { encodingOptions, synthesisOptions } from '../src/server/server.js';
import { INDEX_PAGE } from '../src/server/index-page.js';
import { itUnless, sandboxed } from './helpers/skip.js';
import { withVoiceServer } from './helpers/voice-server.js';

const withServer = (run) =>
  withVoiceServer({ version: '1.2.3', index: '<h1>hi</h1>' }, run);

const itNet = itUnless(sandboxed);

describe('default tier', () => {
  it('renders 3D acoustics unless a request asks for another tier', () => {
    expect(synthesisOptions({ text: 'a' }).options.tier).toBe('studio');
    expect(synthesisOptions({ text: 'a', tier: 'medium' }).options.tier).toBe(
      'medium'
    );
    expect(INDEX_PAGE).toContain('<option selected>studio</option>');
    expect(INDEX_PAGE).toContain('<option>reference</option>');
  });
});

describe('voice server', () => {
  itNet('serves health, IPA, tiers and the index page', async () => {
    await withServer(async (base) => {
      const health = await fetch(`${base}/api/health`).then((r) => r.json());
      expect(health).toEqual({ status: 'ok', version: '1.2.3' });
      const query = new globalThis.URLSearchParams({
        text: 'мама',
        lang: 'ru',
      });
      const ipa = await fetch(`${base}/api/ipa?${query}`).then((r) => r.json());
      expect(ipa.ipa).toBe('ˈmamə');
      const tiers = await fetch(`${base}/api/tiers`).then((r) => r.json());
      expect(tiers.audio[0].name).toBe('minimal');
      expect(tiers.default).toBe('studio');
      const page = await fetch(base);
      expect(page.headers.get('access-control-allow-origin')).toBe('*');
      expect(await page.text()).toBe('<h1>hi</h1>');
    });
  });

  itNet('returns JSON errors for bad requests', async () => {
    await withServer(async (base) => {
      const missing = await fetch(`${base}/api/synthesize`);
      expect(missing.status).toBe(400);
      expect((await missing.json()).error).toContain('text');
      const long = await fetch(
        `${base}/api/synthesize?text=${'a'.repeat(2001)}`
      );
      expect(long.status).toBe(413);
      const tier = await fetch(`${base}/api/synthesize?text=a&tier=nope`);
      expect(tier.status).toBe(400);
      expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    });
  });

  itNet('synthesizes WAV from a JSON POST body', async () => {
    await withServer(async (base) => {
      const response = await fetch(`${base}/api/synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'ˈmama',
          ipa: true,
          tier: 'minimal',
          sampleRate: 16000,
          head: 'random',
          seed: 2,
        }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('audio/wav');
      expect(decodeURIComponent(response.headers.get('x-ipa'))).toBe('ˈmama');
      const wav = decodeWav(new Uint8Array(await response.arrayBuffer()));
      expect(wav.sampleRate).toBe(16000);
      expect(wav.samples.length > 4000).toBe(true);
    });
  });

  itNet('streams WAV chunks', async () => {
    await withServer(async (base) => {
      const response = await fetch(
        `${base}/api/stream?text=Hello&tier=minimal&sampleRate=16000`
      );
      expect(response.status).toBe(200);
      let bytes = 0;
      let chunks = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        chunks++;
      }
      expect(chunks > 1).toBe(true);
      expect(bytes > 44 + 2 * 4000).toBe(true);
    });
  });

  itNet('exports the head mesh and a random head', async () => {
    await withServer(async (base) => {
      const obj = await fetch(`${base}/api/mesh.obj?seed=3&lod=0`).then((r) =>
        r.text()
      );
      expect(obj).toContain('o tract');
      const head = await fetch(`${base}/api/head/random?seed=3`).then((r) =>
        r.json()
      );
      expect(typeof head.vocalTractLength).toBe('number');
    });
  });
});

describe('voice server audio formats', () => {
  it('validates the output encoding', () => {
    expect(encodingOptions({})).toEqual({
      format: 'wav',
      bitDepth: 16,
      float: false,
    });
    expect(encodingOptions({ format: 'FLAC', bitDepth: '24' })).toEqual({
      format: 'flac',
      bitDepth: 24,
      float: false,
    });
    expect(encodingOptions({ format: 'au', float: 'true' })).toEqual({
      format: 'au',
      bitDepth: 32,
      float: true,
    });
    expect(() => encodingOptions({ format: 'mp3' })).toThrow('mp3');
  });

  itNet('synthesizes every format with its content type', async () => {
    await withServer(async (base) => {
      const query = 'text=%CB%88mama&ipa=true&tier=minimal&sampleRate=16000';
      const expected = {
        flac: 'audio/flac',
        aiff: 'audio/aiff',
        au: 'audio/basic',
        raw: 'application/octet-stream',
      };
      for (const [format, mimeType] of Object.entries(expected)) {
        const response = await fetch(
          `${base}/api/synthesize?${query}&format=${format}&bitDepth=24`
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe(mimeType);
        expect(response.headers.get('content-disposition')).toContain(
          `voice.${format}`
        );
        const bytes = new Uint8Array(await response.arrayBuffer());
        const decoded = decodeAudio(bytes, {
          format: 'raw',
          sampleRate: 16000,
          bitDepth: 24,
        });
        expect(decoded.format).toBe(format);
        expect(decoded.bitDepth).toBe(24);
        expect(decoded.samples.length > 4000).toBe(true);
      }
      const bad = await fetch(
        `${base}/api/synthesize?${query}&format=flac&float=true`
      );
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toContain('float');
    });
  });

  itNet('streams AU and raw, and refuses unstreamable formats', async () => {
    await withServer(async (base) => {
      const query = 'text=Hello&tier=minimal&sampleRate=16000';
      const au = await fetch(`${base}/api/stream?${query}&format=au`);
      expect(au.status).toBe(200);
      expect(au.headers.get('content-type')).toBe('audio/basic');
      const decoded = decodeAudio(new Uint8Array(await au.arrayBuffer()));
      expect(decoded.format).toBe('au');
      expect(decoded.samples.length > 4000).toBe(true);

      const raw = await fetch(
        `${base}/api/stream?${query}&format=raw&float=true`
      );
      expect(raw.headers.get('content-type')).toBe('application/octet-stream');
      const floats = (await raw.arrayBuffer()).byteLength;
      expect(floats % 4).toBe(0);
      expect(floats / 4).toBe(decoded.samples.length);

      for (const format of ['flac', 'aiff']) {
        const refused = await fetch(
          `${base}/api/stream?${query}&format=${format}`
        );
        expect(refused.status).toBe(400);
        expect((await refused.json()).error).toContain('cannot be streamed');
      }
    });
  });
});
