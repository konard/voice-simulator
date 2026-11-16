import { describe, it, expect } from 'test-anywhere';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../bin/voice-simulator.js';
import {
  decodeAudio,
  detectAudioFormat,
  encodeHeadConfig,
  presetHeadConfig,
} from '../src/index.js';
import { noRust } from './helpers/rust-engine.js';
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

  itUnless(sandboxed)('renders the telephone tier at 8 kHz', () =>
    withTempDir(async (dir) => {
      const out = join(dir, 'telephone.wav');
      const say = ['say', 'ˈmama', '--ipa', '--tier', 'telephone'];
      const result = await cli([...say, '-o', out]);
      expect(result.code).toBe(0);
      const decoded = decodeAudio(readFileSync(out));
      expect(decoded.sampleRate).toBe(8000);
      expect(decoded.samples.length > 2000).toBe(true);
    })
  );

  it('renders with the 2D solver', async () => {
    const say = ['say', 'ˈmama', '--ipa', '--solver', 'fdtd2d', '-o', '-'];
    const result = await cli(say);
    expect(result.code).toBe(0);
    const { samples } = decodeAudio(result.bytes);
    expect(samples.length > 1000).toBe(true);
    expect(samples.some((value) => value !== 0)).toBe(true);
    // --dx sets the cell size of the sheet.
    const coarse = await cli([...say, '--dx', '0.8']);
    expect(coarse.code).toBe(0);
    const other = decodeAudio(coarse.bytes).samples;
    expect(other.length).toBe(samples.length);
    expect(other.some((value, index) => value !== samples[index])).toBe(true);
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

describe('CLI voice files', () => {
  itUnless(sandboxed)('renders with a voice file', () =>
    withTempDir(async (dir) => {
      const file = join(dir, 'bass.json');
      const voice = await cli(['head', '--preset', 'bass', '--voice-file']);
      expect(voice.code).toBe(0);
      expect(JSON.parse(voice.stdout[0]).preset).toBe('bass');
      writeFileSync(file, voice.stdout[0]);
      expect((await cli(['voice', 'check', file])).stdout[0]).toBe(
        `${file}: ok, preset bass`
      );
      // --voice gives the head of the file: the mid-size bass.
      const bass = encodeHeadConfig(presetHeadConfig('bass'));
      const rendered = await cli([...SAY, '-o', '-', '--voice', file]);
      expect(rendered.code).toBe(0);
      expect(rendered.bytes).toEqual(
        (await cli([...SAY, '-o', '-', '--head', bass])).bytes
      );
      // --head wins over --voice, which wins over --preset.
      const head = await cli([
        ...SAY,
        '-o',
        '-',
        '--voice',
        file,
        '--head',
        'pitch=200',
      ]);
      expect(head.bytes).toEqual(
        (await cli([...SAY, '-o', '-', '--head', 'pitch=200'])).bytes
      );
      const preset = await cli([
        ...SAY,
        '-o',
        '-',
        '--voice',
        file,
        '--preset',
        'soprano',
      ]);
      expect(preset.bytes).toEqual(rendered.bytes);
      // head --voice prints the flat head of the file.
      const flat = await cli(['head', '--voice', file]);
      expect(flat.stdout[0]).toBe(bass);
    })
  );

  itUnless(sandboxed)('rejects a broken voice file', () =>
    withTempDir(async (dir) => {
      const file = join(dir, 'broken.json');
      writeFileSync(
        file,
        JSON.stringify({
          format: 'voice-simulator/voice',
          version: 1,
          folds: { pitch: 900, wobble: 1 },
          breathing: { pitch: 120 },
        })
      );
      const problems = [
        `${file}: folds.pitch = 900 is outside 60 to 320 Hz`,
        'unknown key "folds.wobble"',
        'breathing.pitch belongs to the group folds',
      ].join('\n');
      const check = await cli(['voice', 'check', file]);
      expect(check.code).toBe(1);
      expect(check.stderr[0]).toBe(problems);
      const say = await cli([...SAY, '-o', '-', '--voice', file]);
      expect(say.code).toBe(1);
      expect(say.stderr[0]).toBe(problems);
      expect(say.bytes).toBe(undefined);
      const missing = await cli(['voice', 'check', join(dir, 'none.json')]);
      expect(missing.code).toBe(1);
      expect((await cli(['voice', 'list'])).code).toBe(1);
    })
  );
});

describe('CLI speech markup', () => {
  it('reads markup with --markup and plain text with --plain', async () => {
    const help = await cli(['--help']);
    expect(help.stdout.join('\n')).toContain('--markup');
    expect(help.stdout.join('\n')).toContain('--plain');
    const marked = await cli([
      'ipa',
      '--markup',
      '[whisper]Hello[/whisper] world.',
    ]);
    expect(marked.code).toBe(0);
    expect(marked.stdout.join('\n')).toBe('{W həˈloʊ W} ˈwɝld .');
    const unknown = await cli(['ipa', '--markup', '[zzz]Hi[/zzz]']);
    expect(unknown.code).toBe(0);
    expect(unknown.stderr.join('\n')).toContain('markup:');
    const doctype = await cli(['ipa', '<!DOCTYPE x><speak>Hi</speak>']);
    expect(doctype.code).toBe(1);
    const both = await cli(['ipa', '--markup', '--plain', 'Hi']);
    expect(both.code).toBe(1);
  });
});

describe('CLI engines', () => {
  itUnless(noRust)(
    '--engine js and --engine rust render the same length',
    async () => {
      const js = await cli([...SAY, '-o', '-', '--engine', 'js']);
      const rust = await cli([...SAY, '-o', '-', '--engine', 'rust']);
      expect(js.code).toBe(0);
      expect(rust.code).toBe(0);
      const jsSamples = decodeAudio(js.bytes).samples;
      const rustSamples = decodeAudio(rust.bytes).samples;
      expect(jsSamples.length > 1000).toBe(true);
      expect(rustSamples.length).toBe(jsSamples.length);
    }
  );

  it('rejects an unknown engine', async () => {
    const result = await cli([...SAY, '-o', '-', '--engine', 'nope']);
    expect(result.code).toBe(1);
    expect(result.stderr.join('\n')).toContain(
      'Unknown engine: nope (auto, rust, js)'
    );
  });

  it('prints the engine of a benchmark', async () => {
    const argv = ['benchmark', '--tier', 'minimal', '--seconds', '0.05'];
    const result = await cli([...argv, '--engine', 'js']);
    expect(result.code).toBe(0);
    expect(result.stdout[0]).toBe('engine: js');
    const json = await cli([...argv, '--json', '--engine', 'js']);
    expect(JSON.parse(json.stdout.join('\n')).engine).toBe('js');
  });
});
