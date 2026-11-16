/**
 * Whisper combined with the phonation types of issue 54: under a full
 * whisper the pulses are gone, so creak, falsetto, breath and harsh leave
 * no voiced frames; the level stays that of a whisper.
 * Run: node experiments/issue-53-whisper-phonation.mjs
 */
import { levelDb, synthesize, voicedShare } from '../src/index.js';

const options = { tier: 'medium', seed: 1, markup: true, headroom: 20 };
const plain = synthesize('Please call Stella.', options).samples;
const reference = levelDb(plain);
for (const tag of [
  '',
  'breathy',
  'creaky',
  'falsetto',
  'harsh',
  'pressed',
  'lax',
]) {
  const inner = tag
    ? `[${tag}]Please call Stella.[/${tag}]`
    : 'Please call Stella.';
  const { samples, sampleRate } = synthesize(
    `[whisper]${inner}[/whisper]`,
    options
  );
  console.log(
    `[whisper]${tag ? `[${tag}]` : ''}`.padEnd(22),
    `voiced ${voicedShare(samples, sampleRate).toFixed(3)}`,
    `level ${(levelDb(samples) - reference).toFixed(1)} dB re plain`
  );
}
