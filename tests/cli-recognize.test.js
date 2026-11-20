import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'test-anywhere';
import { runCli } from '../bin/voice-simulator.js';
import { encodeRaw, encodeWav, synthesize } from '../src/index.js';

const SAMPLE_RATE = 8000;
const FLAGS = ['--lang', 'en', '--level', 'low'];
const speech = () =>
  synthesize('A little bird sings.', {
    lang: 'en',
    tier: 'telephone',
    seed: 1,
  }).samples;

async function run(args, stdin) {
  const lines = [];
  const errors = [];
  const exit = await runCli(['recognize', ...args, ...FLAGS], {
    stdin,
    stdout: (line) => lines.push(line),
    stderr: (line) => errors.push(line),
  });
  assert.deepEqual(errors, []);
  assert.equal(exit, 0);
  return lines;
}

it('recognizes a file and prints plain text, JSON and IPA', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-recognize-'));
  try {
    const file = join(dir, 'speech.wav');
    const bytes = encodeWav(speech(), SAMPLE_RATE);
    writeFileSync(file, bytes);
    const [json] = await run([file, '--json']);
    const result = JSON.parse(json);
    assert.deepEqual(Object.keys(result), [
      'ipa',
      'text',
      'languages',
      'words',
      'modes',
      'voice',
    ]);
    assert.ok(result.words.length > 0);
    assert.deepEqual(await run([file]), [result.text]);
    assert.deepEqual(await run([file, '--ipa']), [result.ipa]);
    assert.deepEqual(
      await run(['-', '--json'], [bytes.subarray(0, 11), bytes.subarray(11)]),
      [json]
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('prints a raw stdin final while reading a two-chunk PCM stream', async () => {
  const signal = new Float32Array(SAMPLE_RATE * 3);
  signal.set(speech());
  const bytes = encodeRaw(signal, SAMPLE_RATE, { bitDepth: 24 });
  const split = 2 * SAMPLE_RATE * 3 + 1;
  const lines = [];
  async function* chunks() {
    yield bytes.subarray(0, split);
    assert.equal(lines.length, 1, 'first final must precede the next chunk');
    yield bytes.subarray(split);
  }
  const errors = [];
  const code = await runCli(
    [
      'recognize',
      '-',
      '--format',
      'raw',
      '--sample-rate',
      String(SAMPLE_RATE),
      '--bit-depth',
      '24',
      '--json',
      ...FLAGS,
    ],
    {
      stdin: chunks(),
      stdout: (line) => lines.push(JSON.parse(line)),
      stderr: (line) => errors.push(line),
    }
  );
  assert.deepEqual(errors, []);
  assert.equal(code, 0);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].words.length);
});
