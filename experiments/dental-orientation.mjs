// Check that a single arch is oriented the same way (crowns found at the
// same end) as when both arches are measured together, for every fetched
// Open-Full-Jaw patient.
// Usage: node experiments/dental-orientation.mjs <open-full-jaw directory>
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { toothLandmarks } from '../src/geometry/dental.js';
import { loadDentition } from '../scripts/fetch-anatomy.mjs';

const root = process.argv[2];
for (let patient = 1; patient <= 17; patient++) {
  const directory = join(root, `Patient_${patient}`);
  if (!existsSync(directory)) {
    continue;
  }
  const teeth = loadDentition('open-full-jaw', directory);
  const both = toothLandmarks(teeth);
  const report = [];
  for (const jaw of ['upper', 'lower']) {
    const alone = toothLandmarks(teeth.filter((tooth) => tooth.jaw === jaw));
    if (!alone.length) {
      continue;
    }
    const gap = Math.max(
      ...alone.map((tooth) => {
        const match = both.find(
          (t) => t.jaw === jaw && t.side === tooth.side && t.type === tooth.type
        );
        return Math.hypot(
          ...tooth.occlusal.map((v, a) => v - match.occlusal[a])
        );
      })
    );
    report.push(
      `${jaw} ${alone.length} teeth, max occlusal shift ${gap.toFixed(2)} mm`
    );
  }
  console.log(`Patient_${patient}: ${report.join('; ')}`);
}
