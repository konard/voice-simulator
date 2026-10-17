/**
 * The word and syllable timeline is available from every entry point:
 * the library, the CLI and the HTTP API.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'test-anywhere';
import {
  prepareUtterance,
  synthesize,
  timelineAt,
  utteranceTimeline,
} from '../src/index.js';
import { runCli } from '../bin/voice-simulator.js';
import { createVoiceServer } from '../src/server/server.js';
import { itUnless, sandboxed } from './helpers/skip.js';

async function cli(args) {
  const stdout = [];
  const stderr = [];
  const code = await runCli(args, {
    stderr: (line) => stderr.push(line),
    stdout: (line) => stdout.push(line),
    stdoutBytes: () => {},
  });
  return { code, stdout, stderr };
}

describe('timeline in the library', () => {
  it('is exported and returned by prepareUtterance and synthesize', () => {
    const result = synthesize('мама', { lang: 'ru', tier: 'minimal' });
    expect(result.timeline.words.map((word) => word.text)).toEqual(['мама']);
    expect(result.timeline.duration <= result.duration + 1e-9).toBe(true);
    const prepared = prepareUtterance('мама', { lang: 'ru' });
    expect(utteranceTimeline(prepared.plan, prepared)).toEqual(
      utteranceTimeline(prepared.plan, {
        words: prepared.words,
        ipa: prepared.ipa,
        language: prepared.lang,
      })
    );
    const [word] = prepared.timeline.words;
    expect(timelineAt(prepared.timeline, word.start)).toEqual({
      word: 0,
      syllable: 0,
    });
  });
});

describe('timeline in the CLI', () => {
  it('prints one line per word with its syllables', async () => {
    const { code, stdout } = await cli(['timeline', '-l', 'ru', 'Привет, мир']);
    expect(code).toBe(0);
    expect(stdout.length).toBe(2);
    expect(stdout[0]).toContain('Привет /prʲɪ.ˈvʲet/ При·вет');
    expect(stdout[1]).toContain('мир');
  });

  it('prints JSON with the accent', async () => {
    const { code, stdout } = await cli([
      'timeline',
      '--json',
      '--accent',
      'en-GB',
      'water',
    ]);
    expect(code).toBe(0);
    const result = JSON.parse(stdout[0]);
    expect(result.accent).toBe('en-GB');
    expect(result.timeline.words[0].ipa).toBe('ˈwɔːtə');
    expect(result.timeline.words[0].syllables.map((s) => s.text)).toEqual([
      'wa',
      'ter',
    ]);
  });

  it('adds the timeline to the JSON summary of say', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-timeline-'));
    try {
      const out = join(dir, 'voice.wav');
      const { code, stdout } = await cli([
        'say',
        '--json',
        '-t',
        'minimal',
        '-o',
        out,
        'hi',
      ]);
      expect(code).toBe(0);
      const result = JSON.parse(stdout[0]);
      expect(result.out).toBe(out);
      expect(result.timeline.words[0].text).toBe('hi');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('timeline in the HTTP API', () => {
  itUnless(sandboxed)('serves /api/timeline', async () => {
    const server = createVoiceServer({ version: '1.0.0' });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const query = new globalThis.URLSearchParams({
        text: '你好',
        lang: 'zh',
      });
      const result = await fetch(`${base}/api/timeline?${query}`).then((r) =>
        r.json()
      );
      expect(result.lang).toBe('zh');
      expect(result.timeline.words.map((word) => word.text)).toEqual([
        '你',
        '好',
      ]);
      const missing = await fetch(`${base}/api/timeline`);
      expect(missing.status).toBe(400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
