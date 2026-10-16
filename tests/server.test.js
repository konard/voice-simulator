/**
 * HTTP API: JSON endpoints, WAV synthesis and streaming.
 */

import { describe, expect } from 'test-anywhere';
import { createVoiceServer, decodeWav } from '../src/index.js';
import { itUnless, sandboxed } from './helpers/skip.js';

async function withServer(run) {
  const server = createVoiceServer({ version: '1.2.3', index: '<h1>hi</h1>' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const itNet = itUnless(sandboxed);

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
