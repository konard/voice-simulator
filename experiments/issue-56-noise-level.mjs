// Issue 56: calibrate NOISE_LEVEL (src/articulation/sounds.js). A copy of
// src/ in a temporary directory gets a flat inhale at `level` L and the
// NOISE_LEVEL under test; the inhale of `[inhale] Yes` (without its first
// and last 50 ms) is measured against the vowel of `Yes`. A calibrated
// NOISE_LEVEL puts the inhale L dB re the vowel. The second table is the
// recipe as it is: the inhale (rising -40 to -30 dB), the exhale and the
// bursts of the cough against the vowel.
// node experiments/issue-56-noise-level.mjs [noiseLevel ...]
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new globalThis.URL('../src/', import.meta.url).pathname;
const INHALE =
  "parts: () => [{ phone: 'ə', seconds: 0.4, noise: true, level: [-40, -30] }]";
const OPTIONS = { tier: 'medium', seed: 1, markup: true };

async function withCopy(noiseLevel, inhaleLevel, run) {
  const dir = mkdtempSync(join(tmpdir(), 'vs-noise-'));
  cpSync(here, join(dir, 'src'), { recursive: true });
  const file = join(dir, 'src/articulation/sounds.js');
  let text = readFileSync(file, 'utf8').replace(
    /export const NOISE_LEVEL = -?\d+(\.\d+)?;/,
    `export const NOISE_LEVEL = ${noiseLevel};`
  );
  if (inhaleLevel !== undefined) {
    text = text.replace(
      INHALE,
      INHALE.replace('[-40, -30]', `[${inhaleLevel}, ${inhaleLevel}]`)
    );
  }
  writeFileSync(file, text);
  try {
    return await run(await import(join(dir, 'src/index.js')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function measure({ synthesize, levelDb }, text, trim = 0.05) {
  const result = synthesize(text, OPTIONS);
  const at = (t) => Math.round(t * result.sampleRate);
  const vowel = result.plan.segments.find(
    (s) => s.kind === 'vowel' && !s.soundOf
  );
  const sound = result.plan.sounds[0];
  const level = levelDb(
    result.samples,
    at(sound.start + trim),
    at(sound.end - trim)
  );
  const reference = vowel
    ? levelDb(result.samples, at(vowel.start), at(vowel.end))
    : NaN;
  return { level, reference, result };
}

const current = Number(
  /export const NOISE_LEVEL = (-?\d+(\.\d+)?);/.exec(
    readFileSync(join(here, 'articulation/sounds.js'), 'utf8')
  )[1]
);
const levels = process.argv.slice(2).map(Number);
for (const noiseLevel of levels.length ? levels : [current]) {
  console.log(`NOISE_LEVEL ${noiseLevel}`);
  for (const inhaleLevel of [0, -10, -20, -30, -40]) {
    const { level, reference } = await withCopy(noiseLevel, inhaleLevel, (vs) =>
      measure(vs, '[inhale] Yes')
    );
    console.log(
      `  flat inhale L ${inhaleLevel}: ${(level - reference).toFixed(1)} dB re the vowel`
    );
  }
  await withCopy(noiseLevel, undefined, (vs) => {
    const inhale = measure(vs, '[inhale] Yes', 0);
    const exhale = measure(vs, 'Yes [exhale]', 0);
    console.log(
      `  inhale ${(inhale.level - inhale.reference).toFixed(1)} dB, exhale ${(exhale.level - exhale.reference).toFixed(1)} dB re the vowel`
    );
    const cough = vs.synthesize('Yes [cough]', OPTIONS);
    const at = (t) => Math.round(t * cough.sampleRate);
    const vowel = cough.plan.segments.find(
      (s) => s.kind === 'vowel' && !s.soundOf
    );
    const reference = vs.levelDb(cough.samples, at(vowel.start), at(vowel.end));
    const bursts = cough.plan.segments
      .filter((s) => s.soundOf && s.noise)
      .map((s) => {
        const frames = [];
        for (let t = s.start; t + 0.01 <= s.end; t += 0.01) {
          frames.push(
            vs.levelDb(cough.samples, at(t), at(t + 0.01)) - reference
          );
        }
        return `${(vs.levelDb(cough.samples, at(s.start), at(s.end)) - reference).toFixed(1)} (frames ${frames.map((f) => f.toFixed(0)).join(' ')})`;
      });
    console.log(`  cough bursts ${bursts.join(', ')} dB re the vowel`);
  });
}
