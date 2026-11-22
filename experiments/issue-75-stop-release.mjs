/** Inspect the stop release features available after a detected closure. Unlicense. */
import {
  analyzeFrames,
  buildCodebook,
  errorRate,
  invertArticulation,
  presetHeadConfig,
  recognize,
  synthesize,
} from '../src/index.js';
import { Biquad } from '../src/acoustics/filters.js';
import { sentences } from '../tests/helpers/roundtrip.js';

function highpass(samples, sampleRate, cutoff) {
  const filter = new Biquad().highpass(cutoff, Math.SQRT1_2, sampleRate);
  return Float32Array.from(samples, (sample) => filter.process(sample));
}

function compareRecognition() {
  for (const [lang, index] of Object.entries({ en: 17, ru: 1, hi: 1, zh: 1 })) {
    const { samples, sampleRate, ipa } = synthesize(sentences[lang][index], {
      lang,
      tier: 'telephone',
      head: 'random',
      preset: 'male',
      seed: 1,
    });
    for (const cutoff of [0, 70, 140]) {
      const input = cutoff ? highpass(samples, sampleRate, cutoff) : samples;
      const heard = recognize(input, sampleRate, { level: 'low' });
      console.log(
        JSON.stringify({
          lang,
          cutoff,
          ...errorRate(ipa, heard.ipa, 'phone'),
          language: heard.languages[0]?.language,
        })
      );
    }
  }
}

function compareStops(fullCodebook) {
  const tiers = fullCodebook ? ['waveguide-16000'] : ['telephone', 'wideband'];
  const presets = fullCodebook ? ['male'] : ['male', 'female'];
  const vowels = fullCodebook ? ['a'] : ['a', 'i', 'u'];
  for (const preset of presets) {
    const head = presetHeadConfig(preset);
    const codebook = buildCodebook(head, { size: fullCodebook ? 5000 : 256 });
    for (const tier of tiers) {
      for (const ipa of vowels.flatMap((v) =>
        ['p', 't', 'k'].map((c) => v + c + v)
      )) {
        const { samples, sampleRate, plan } = synthesize(ipa, {
          ipa: true,
          head,
          ...(fullCodebook
            ? { solver: 'waveguide', sampleRate: 16000 }
            : { tier }),
          engine: 'js',
          seed: 1,
        });
        const frames = analyzeFrames(samples, sampleRate);
        const closure = plan.segments.find(({ kind }) => kind === 'consonant');
        const start = Math.round(closure.start / frames.hop);
        const end = Math.round(closure.end / frames.hop);
        const center = Math.round(
          (closure.start + closure.end) / (2 * frames.hop)
        );
        const baseline = invertArticulation(frames, { voice: head, codebook });
        const speech = Uint8Array.from(
          frames.speech,
          (flag, t) => flag && frames.gravity[t] >= 50
        );
        const filtered = invertArticulation(
          { ...frames, speech },
          { voice: head, codebook }
        );
        const highpassTracks = [70, 140].map((cutoff) =>
          invertArticulation(
            analyzeFrames(highpass(samples, sampleRate, cutoff), sampleRate),
            { voice: head, codebook }
          )
        );
        const release = Array.from({ length: end - start + 6 }, (_, i) => {
          const t = start + i;
          return {
            speech: frames.speech[t],
            energy: Math.round(frames.energy[t]),
            noise: Math.round(frames.noise[t]),
            gravity: Math.round(frames.gravity[t]),
            periodicity: Number(frames.periodicity[t].toFixed(2)),
            bands: Array.from(
              frames.band.subarray(t * 6, (t + 1) * 6),
              Math.round
            ),
          };
        });
        const tracks = {
          baseline,
          below50HzAsGap: filtered,
          highpass70Hz: highpassTracks[0],
          highpass140Hz: highpassTracks[1],
        };
        const atCenter = (name) =>
          Object.fromEntries(
            Object.entries(tracks).map(([condition, track]) => [
              condition,
              track.channels[name][center],
            ])
          );
        console.log(
          JSON.stringify({
            tier,
            preset,
            ipa,
            start,
            end,
            center,
            lipAmount: atCenter('lipAmount'),
            tongueLocation: atCenter('tongueLocation'),
            release,
          })
        );
      }
    }
  }
}

if (process.argv.includes('--recognition')) {
  compareRecognition();
} else {
  compareStops(process.argv.includes('--full-codebook'));
}
