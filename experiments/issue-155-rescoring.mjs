/** Compare full-reference and matched-context waveguide renders. Unlicense. */
import {
  audioToIpa,
  createVoiceFitter,
  errorRate,
  planReading,
  planRescoring,
  scoreJob,
} from '../src/index.js';
import { applyRescoring } from '../src/recognition/rescoring.js';
import { loadGolden } from '../tests/helpers/golden.js';

const rates = [16000, 8000];
const weights = [0, 0.05, 0.1, 0.2, 0.5, 1];
const items = loadGolden();
const rows = [];

function measure(item, voice, rate) {
  const decoded = audioToIpa(item.samples, item.sampleRate, {
    voice,
    language: item.lang,
    nbest: 10,
    rate,
  });
  const prepared = planRescoring(decoded);
  const original = prepared.jobs.map(scoreJob);
  const matched = [...original];
  const adjacent = [];
  const adjacentUnbiased = [];
  let index = 0;
  for (const region of prepared.scheduled) {
    const { start, end, alternatives } = region;
    const base = decoded.nbest[0].segments;
    const previous = base.find(({ end }) => end === start);
    const next = base.find(({ start }) => start === end);
    for (const { segments } of alternatives) {
      const job = prepared.jobs[index];
      if (job.reference) {
        const context = (from, to) =>
          base.filter((segment) => segment.start >= from && segment.end <= to);
        const plan = planReading(decoded, context(job.from, job.to));
        matched[index] = scoreJob({ ...job, reference: undefined, plan });
      }
      const phones = [previous, ...segments, next].filter(
        (segment) => segment && segment.kind !== 'pause'
      );
      const plan = planReading(decoded, phones);
      const local = { ...job, reference: undefined, plan };
      adjacent.push(scoreJob(local));
      adjacentUnbiased.push(
        scoreJob({ ...local, bias: job.bias.map(() => 0) })
      );
      index++;
    }
  }
  const per = (ipa) => errorRate(item.ipa, ipa, 'phone').rate;
  const policies = { original, matched, adjacent, adjacentUnbiased };
  for (const [policy, scores] of Object.entries(policies)) {
    for (const weight of weights) {
      const revised = applyRescoring(decoded, prepared, scores, weight);
      rows.push({
        lang: item.lang,
        rate,
        policy,
        weight,
        before: per(decoded.ipa),
        after: per(revised.ipa),
        changed: revised.rescoring.changed,
      });
    }
  }
}

for (const id of new Set(items.map(({ speaker }) => speaker.id))) {
  const recordings = items.filter(({ speaker }) => speaker.id === id);
  const fitter = createVoiceFitter({
    refine: false,
    language: recordings[0].lang,
  });
  for (const { samples, sampleRate } of recordings) {
    fitter.update(samples, sampleRate);
  }
  const { head } = fitter.result();
  for (const item of recordings) {
    for (const rate of rates) {
      measure(item, head, rate);
    }
  }
  console.log('Measured', id);
}

const meanPercent = (rows, key) =>
  ((100 * rows.reduce((sum, row) => sum + row[key], 0)) / rows.length).toFixed(
    4
  );
for (const policy of new Set(rows.map(({ policy }) => policy))) {
  for (const weight of weights) {
    const selected = rows.filter(
      (row) => row.policy === policy && row.weight === weight
    );
    for (const rate of rates) {
      const atRate = selected.filter((row) => row.rate === rate);
      const byLanguage = Object.fromEntries(
        [...new Set(atRate.map(({ lang }) => lang))].map((lang) => [
          lang,
          meanPercent(
            atRate.filter((row) => row.lang === lang),
            'after'
          ),
        ])
      );
      console.log(
        policy,
        weight,
        rate,
        meanPercent(atRate, 'before'),
        meanPercent(atRate, 'after'),
        atRate.reduce((sum, row) => sum + row.changed, 0),
        byLanguage
      );
    }
  }
}
