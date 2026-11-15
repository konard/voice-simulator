import { describe, it, expect } from 'test-anywhere';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../bin/voice-simulator.js';
import { decodeAudio, detectAudioFormat } from '../src/index.js';
import { itUnless, sandboxed } from './helpers/skip.js';

const SAY = ['say', 'ˈmama', '--ipa', '--tier', 'minimal'];

async function cli(argv) {
  const stdout = [];
  const stderr = [];
  const bytes = [];
  const code = await runCli(argv, {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    stdoutBytes: (data) => bytes.push(data),
  });
  return { code, stdout, stderr, bytes: bytes[0] };
}

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'voice-simulator-audio-'));
  return Promise.resolve(run(dir)).finally(() =>
    rmSync(dir, { recursive: true, force: true })
  );
}

describe('CLI audio formats', () => {
  it('writes 16-bit WAV to stdout by default', async () => {
    const result = await cli([...SAY, '-o', '-']);
    expect(result.code).toBe(0);
    const decoded = decodeAudio(result.bytes);
    expect(decoded.format).toBe('wav');
    expect(decoded.bitDepth).toBe(16);
    expect(decoded.samples.length > 1000).toBe(true);
  });

  it('honours --format, --bit-depth and --float', async () => {
    const au = await cli([...SAY, '-o', '-', '--format', 'au', '-b', '24']);
    expect(au.code).toBe(0);
    expect(decodeAudio(au.bytes).format).toBe('au');
    expect(decodeAudio(au.bytes).bitDepth).toBe(24);

    const float = await cli([...SAY, '-o', '-', '-f', 'aiff', '--float']);
    expect(float.code).toBe(0);
    expect(decodeAudio(float.bytes).float).toBe(true);
    expect(decodeAudio(float.bytes).bitDepth).toBe(32);
  });

  it('selects the voice source with --source', async () => {
    const folds = await cli([...SAY, '-o', '-', '--source', 'folds']);
    expect(folds.code).toBe(0);
    const decoded = decodeAudio(folds.bytes);
    expect(decoded.format).toBe('wav');
    expect(decoded.samples.length > 1000).toBe(true);
    const lf = await cli([...SAY, '-o', '-', '--source', 'lf']);
    expect(lf.bytes).toEqual((await cli([...SAY, '-o', '-'])).bytes);
    const unknown = await cli([...SAY, '-o', '-', '--source', 'x']);
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr[0]).toContain('Unknown source: x');
  });

  it('rejects encodings the format cannot store', async () => {
    const result = await cli([...SAY, '-o', '-', '-f', 'flac', '--float']);
    expect(result.code).toBe(1);
    expect(result.stderr[0]).toContain('FLAC has no float samples');
    const unknown = await cli([...SAY, '-o', '-', '-f', 'mp3']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr[0]).toContain('Unknown audio format "mp3"');
  });

  itUnless(sandboxed)('infers the format from the -o extension', () =>
    withTempDir(async (dir) => {
      const out = join(dir, 'voice.flac');
      const result = await cli([...SAY, '-o', out, '-b', '24']);
      expect(result.code).toBe(0);
      expect(result.stdout[0]).toContain(out);
      const decoded = decodeAudio(readFileSync(out));
      expect(decoded.format).toBe('flac');
      expect(decoded.bitDepth).toBe(24);

      const unknown = await cli([...SAY, '-o', join(dir, 'voice.mp3')]);
      expect(unknown.code).toBe(1);
      expect(unknown.stderr[0]).toContain('Unknown audio extension ".mp3"');

      const forced = join(dir, 'voice.bin');
      expect((await cli([...SAY, '-o', forced, '-f', 'au'])).code).toBe(0);
      expect(detectAudioFormat(readFileSync(forced))).toBe('au');
    })
  );

  itUnless(sandboxed)('converts between formats and sample rates', () =>
    withTempDir(async (dir) => {
      const source = join(dir, 'voice.flac');
      expect((await cli([...SAY, '-o', source])).code).toBe(0);
      const original = decodeAudio(readFileSync(source));

      const out = join(dir, 'voice.aiff');
      const result = await cli([
        'convert',
        source,
        '-o',
        out,
        '--sample-rate',
        '8000',
      ]);
      expect(result.code).toBe(0);
      expect(result.stdout[0]).toContain('flac 1 ch');
      const converted = decodeAudio(readFileSync(out));
      expect(converted.format).toBe('aiff');
      expect(converted.sampleRate).toBe(8000);
      const expected = Math.round(
        (original.samples.length * 8000) / original.sampleRate
      );
      expect(converted.samples.length).toBe(expected);

      const missing = await cli(['convert', source]);
      expect(missing.code).toBe(1);
      expect(missing.stderr[0]).toBe('Missing -o <out>');
    })
  );

  itUnless(sandboxed)('compare prints JSON', () =>
    withTempDir(async (dir) => {
      const a = join(dir, 'a.wav');
      const b = join(dir, 'b.wav');
      const say = ['say', 'Hello.', '-t', 'minimal'];
      expect((await cli([...say, '-s', '1', '-o', a])).code).toBe(0);
      expect((await cli([...say, '-s', '2', '-o', b])).code).toBe(0);

      const result = await cli(['compare', a, b, '--json']);
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout.join('\n'));
      for (const key of ['lsd', 'mcd', 'f0', 'timing']) {
        expect(key in parsed).toBe(true);
      }
      expect(Number.isFinite(parsed.mcd)).toBe(true);
      expect(Number.isFinite(parsed.f0.rmseCents)).toBe(true);
      expect(Number.isFinite(parsed.timing.rmsSeconds)).toBe(true);

      const self = await cli(['compare', a, a]);
      expect(self.code).toBe(0);
      expect(self.stdout[0]).toBe('LSD 0.00 dB');

      const missing = await cli(['compare', a]);
      expect(missing.code).toBe(1);
      expect(missing.stderr[0]).toBe('Missing <reference> <test>');
    })
  );
});
