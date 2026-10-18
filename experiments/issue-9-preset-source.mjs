// H1-H2 and H1-A3 (dB) of sustained nonhigh vowels rendered for each preset
// (mid-size person), the measures of Hanson (1997) and Hanson and Chuang
// (1999, table X): corrected for the vocal tract, H1*-H2* is 0.0 dB for men
// and 3.1 dB for women and H1*-A3* 13.8 and 23.4 dB. The rendered speech
// gives the raw measures and, with the F1 and F2 of real speakers removed,
// the corrected ones; the bare source is the glottal flow derivative alone.
// Usage: [DX=1] node experiments/issue-9-preset-source.mjs [solver] [chink...]
//   (chinks in mm² for the female and child presets, default the preset's)
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import {
  estimateFormants,
  estimatePitch,
  harmonicLevel,
  spectralTilt,
} from '../src/acoustics/analysis.js';
import { Glottis } from '../src/acoustics/glottis.js';
import { presetHeadConfig } from '../src/head-config.js';
import { HILLENBRAND } from '../src/articulation/vowel-norms.js';

const solver = process.argv[2] ?? 'waveguide';
const RATE = 24000;
const WINDOW = 0.08;
const SYMBOLS = ['æ', 'ɑ', 'ʌ', 'ɛ'];

/** H1-H2 and H1-A3 of the glottal source alone for a head at F3 (Hz). */
export function bareSourceMeasures(head, f3) {
  const glottis = new Glottis({
    tenseness: head.tenseness,
    breathiness: 0,
    jitter: 0,
    shimmer: 0,
    aspirationLevel: 0,
    chink: head.glottalChink,
  });
  const control = {
    f0: head.pitch,
    voicing: 1,
    aspiration: 0,
    closure: 0,
    loudness: 1,
  };
  const samples = new Float64Array(Math.round(0.3 * RATE));
  for (let n = 0; n < samples.length; n++) {
    samples[n] = glottis.step(1 / RATE, control, 0);
  }
  const options = { start: 0.1, duration: WINDOW, search: 0 };
  const level = (frequency) => harmonicLevel(samples, RATE, frequency, options);
  const h1 = level(head.pitch);
  return {
    h1h2: h1 - level(2 * head.pitch),
    h1a3: h1 - level(Math.round(f3 / head.pitch) * head.pitch),
  };
}

/**
 * Tilt measures of a rendered sustained vowel; A3 is sought around the F3
 * of real speakers (the formants are calibrated to it), which is steadier
 * than an LPC estimate when the formants are wide.
 */
export function sourceMeasures(head, symbol, group, options = {}) {
  const plan = planUtterance(`ˈ${symbol}ː`, { head });
  const samples = renderPlan(plan, { sampleRate: RATE, head, ...options });
  const vowel = plan.segments.find((segment) => segment.kind === 'vowel');
  const start = (vowel.start + vowel.end) / 2 - WINDOW / 2;
  const range = { start, duration: WINDOW };
  const f0 = estimatePitch(samples, RATE, { ...range, min: 70, max: 450 });
  const [, , f3] = estimateFormants(samples, RATE, {
    ...range,
    count: 3,
    order: 14,
  });
  const formants = HILLENBRAND[group][symbol];
  return { f0, f3, ...spectralTilt(samples, RATE, { ...range, f0, formants }) };
}

if (process.argv[1]?.endsWith('issue-9-preset-source.mjs')) {
  const totals = {};
  const chinks = process.argv.slice(3).map(Number);
  for (const name of ['male', 'female', 'child']) {
    const head = presetHeadConfig(name);
    if (chinks.length && name !== 'male') {
      head.glottalChink = chinks[name === 'female' ? 0 : chinks.length - 1];
    }
    const rows = SYMBOLS.map((symbol) => {
      const result = sourceMeasures(head, symbol, name, {
        solver,
        ...(process.env.DX && { dx: Number(process.env.DX) }),
      });
      console.log(
        `${name} /${symbol}/: f0 ${result.f0.toFixed(0)} F3 ${result.f3.toFixed(0)} H1-H2 ${result.h1h2.toFixed(1)} H1-A3 ${result.h1a3.toFixed(1)}`
      );
      return result;
    });
    const mean = (values) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const source = bareSourceMeasures(
      head,
      mean(SYMBOLS.map((symbol) => HILLENBRAND[name][symbol][2]))
    );
    totals[name] = { source };
    for (const key of ['h1h2', 'h1a3', 'h1h2Corrected', 'h1a3Corrected']) {
      totals[name][key] = mean(rows.map((row) => row[key]));
    }
    console.log(
      `${name} (chink ${head.glottalChink} mm²) mean: H1-H2 ${totals[name].h1h2.toFixed(1)} dB, H1-A3 ${totals[name].h1a3.toFixed(1)} dB; ` +
        `bare source H1-H2 ${source.h1h2.toFixed(1)} dB, H1-A3 ${source.h1a3.toFixed(1)} dB`
    );
  }
  for (const name of ['female', 'child']) {
    const difference = (key, entry = (x) => x) =>
      (entry(totals[name])[key] - entry(totals.male)[key]).toFixed(1);
    console.log(
      `${name} - male: raw H1-H2 ${difference('h1h2')} dB, H1-A3 ${difference('h1a3')} dB; ` +
        `corrected H1*-H2* ${difference('h1h2Corrected')} dB, H1*-A3* ${difference('h1a3Corrected')} dB; ` +
        `bare source H1-H2 ${difference('h1h2', (x) => x.source)} dB, H1-A3 ${difference('h1a3', (x) => x.source)} dB ` +
        `(women - men, Hanson and Chuang 1999: 3.1 and 9.6 dB)`
    );
  }
}
