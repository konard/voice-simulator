// Unlicense. Bound the source calibration probe to fifteen short recordings.
import { synthesize } from '../../src/synthesize.js';
import { analyzeFrames } from '../../src/recognition/frontend.js';
import { trackPitch } from '../../src/recognition/pitch.js';
import { inverseFilter } from '../../src/recognition/inverse-filter.js';
import { percentile } from '../../src/analysis/voice-features.js';
const text = 'The north wind and the sun.';
for (const [name, head] of Object.entries({
  default: {},
  A: { vocalTractLength: 14, pitch: 210, tenseness: 0.45, speechRate: 1.15 },
  B: { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75, speechRate: 0.9 },
})) {
  for (const breathiness of [0, 0.25, 0.5, 0.75, 1]) {
    const audio = synthesize(text, {
      head: { ...head, breathiness },
      seed: 1,
      solver: 'waveguide',
      sampleRate: 16000,
      engine: 'js',
    });
    const frames = analyzeFrames(audio.samples, 16000);
    const pitch = trackPitch(frames);
    const source = inverseFilter(frames, { pitch });
    const rows = [];
    for (let t = 1; t < frames.count - 1; t++) {
      if (source.reliable[t]) {
        rows.push({
          hnr: source.hnr[t],
          rd: source.rd[t],
          fit: source.fit[t],
          slope: Math.abs(pitch.f0[t + 1] - pitch.f0[t - 1]) / pitch.f0[t],
          periodicity: frames.periodicity[t],
        });
      }
    }
    const stats = (r) => ({
      n: r.length,
      hnr: [0.5, 0.75, 0.9].map((p) =>
        percentile(
          r.map((x) => x.hnr),
          p
        )
      ),
      rd: percentile(
        r.map((x) => x.rd),
        0.5
      ),
    });
    console.log(
      JSON.stringify({
        name,
        breathiness,
        all: stats(rows),
        fit3: stats(rows.filter((x) => x.fit <= 3)),
        steady: stats(rows.filter((x) => x.slope < 0.005)),
        periodic: stats(rows.filter((x) => x.periodicity > 0.9)),
      })
    );
  }
}
