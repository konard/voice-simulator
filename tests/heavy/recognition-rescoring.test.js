/** Hold-out analysis-by-synthesis evaluation. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  audioToIpa,
  createVoiceFitter,
  errorRate,
  planRescoring,
  scoreJob,
} from '../../src/index.js';
import { joinSegments } from '../../src/recognition/decode-pipeline.js';
import { applyRescoring } from '../../src/recognition/rescoring.js';
import { pieceKey } from '../../src/recognition/rescoring-regions.js';
import { RESCORING_WEIGHT } from '../../src/recognition/rescoring-weights.js';
import { heldOutDecoderSentences } from '../helpers/decoder-heavy-material.js';
import {
  DECODER_VOICES,
  mean,
  plannedPhones,
  renderDecoderText,
} from '../helpers/decoder-material.js';
import { isReviewed, loadGolden } from '../helpers/golden.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const rates = [16000, 8000];
const languages = ['en', 'ru', 'hi', 'zh'];
const piece = (segments, { start, end }) =>
  segments.filter((segment) => segment.start >= start && segment.end <= end);

function measure(item, voice, rate) {
  const { lang, reference, samples, sampleRate, id, reviewed } = item;
  const decoded = audioToIpa(samples, sampleRate, {
    voice,
    language: lang,
    nbest: 10,
    rate,
  });
  const plan = planRescoring(decoded);
  const result = applyRescoring(
    decoded,
    plan,
    plan.jobs.map(scoreJob),
    RESCORING_WEIGHT
  );
  const per = (ipa) => errorRate(reference, ipa, 'phone').rate;
  const before = per(decoded.ipa);
  const after = per(result.ipa);
  const oracle = Math.min(before, ...decoded.nbest.map(({ ipa }) => per(ipa)));
  const changes = { right: 0, wrong: 0, neutral: 0 };
  for (const region of plan.scheduled) {
    const original = piece(decoded.segments, region);
    const revised = piece(result.segments, region);
    if (pieceKey(original) === pieceKey(revised)) {
      continue;
    }
    // Measure each revision against the same final answer with that region
    // reverted. This works with untimed golden transcripts as well.
    const reverted = [
      ...result.segments.filter(({ end }) => end <= region.start),
      ...original,
      ...result.segments.filter(({ start }) => start >= region.end),
    ];
    const alternative = per(joinSegments(reverted));
    changes[
      after < alternative ? 'right' : after > alternative ? 'wrong' : 'neutral'
    ]++;
  }
  const { regions, scored, changed } = result.rescoring;
  assert.equal(changed, changes.right + changes.wrong + changes.neutral);
  return {
    id,
    lang,
    rate,
    reviewed,
    before,
    after,
    oracle,
    regions,
    scored,
    changed,
    ...changes,
  };
}

function synthetic(lang, limit) {
  const sentences = heldOutDecoderSentences(lang);
  assert.equal(new Set(sentences).size, 50);
  return sentences.slice(0, limit).flatMap((sentence, index) => {
    const preset = index % 2 === 0 ? 'male' : 'female';
    const voice = DECODER_VOICES[preset];
    return rates.map((sampleRate) => {
      const { samples, plan } = renderDecoderText(
        sentence,
        voice,
        sampleRate,
        lang
      );
      const reference = plannedPhones(plan).map(({ ipa }) => ipa);
      return {
        ...measure(
          { id: `${lang}-${index + 1}`, lang, reference, samples, sampleRate },
          voice,
          sampleRate
        ),
        corpus: 'synthetic',
        speaker: preset,
      };
    });
  });
}

function golden(limit) {
  const items = loadGolden();
  const selected = languages.flatMap((lang) =>
    items.filter((item) => item.lang === lang).slice(0, limit)
  );
  const rows = [];
  for (const id of new Set(selected.map(({ speaker }) => speaker.id))) {
    const recordings = items.filter(({ speaker }) => speaker.id === id);
    const fitter = createVoiceFitter({
      refine: false,
      language: recordings[0].lang,
    });
    for (const { samples, sampleRate } of recordings) {
      fitter.update(samples, sampleRate);
    }
    const { head } = fitter.result();
    for (const item of selected.filter(({ speaker }) => speaker.id === id)) {
      for (const rate of rates) {
        rows.push({
          ...measure(
            { ...item, reference: item.ipa, reviewed: isReviewed(item) },
            head,
            rate
          ),
          corpus: 'golden',
          speaker: id,
        });
      }
    }
    console.log('rescoring heavy complete golden', id);
  }
  return rows;
}

function totals(rows) {
  const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
  const rate = (field) =>
    rows.length ? mean(rows.map((row) => row[field])) : 0;
  return {
    count: rows.length,
    before: rate('before'),
    after: rate('after'),
    oracle: rate('oracle'),
    regions: sum('regions'),
    scored: sum('scored'),
    changed: sum('changed'),
    right: sum('right'),
    wrong: sum('wrong'),
    neutral: sum('neutral'),
  };
}

const pct = (value) => `${(100 * value).toFixed(2)}%`;

function write(rows, limit) {
  const groups = [];
  for (const corpus of ['synthetic', 'golden']) {
    for (const lang of languages) {
      for (const rate of rates) {
        const items = rows.filter(
          (row) =>
            row.corpus === corpus && row.lang === lang && row.rate === rate
        );
        if (items.length) {
          groups.push({ corpus, lang, rate, ...totals(items) });
        }
      }
    }
  }
  const summary = Object.fromEntries(
    ['synthetic', 'golden'].map((corpus) => [
      corpus,
      totals(rows.filter((row) => row.corpus === corpus)),
    ])
  );
  const relative =
    (summary.synthetic.before - summary.synthetic.after) /
    summary.synthetic.before;
  const lines = [
    '# Analysis-by-synthesis rescoring',
    '',
    'Reproduce with `node --test tests/heavy/recognition-rescoring.test.js`. The phone error rate (PER) is the mean per recording. The oracle is the best PER in the original n-best list. Each golden speaker uses one head fitted from their recordings, with transcripts used only for scoring.',
    '',
    `Weight: ${RESCORING_WEIGHT}. Synthetic sentences per language and rate: ${Math.min(50, limit)}. Golden references confirmed by a speaker: ${new Set(rows.filter(({ reviewed }) => reviewed).map(({ id }) => id)).size}.`,
    '',
    '<!-- prettier-ignore -->',
    '| Corpus | Language | Hz | Recordings | PER before | PER after | Oracle | Regions changed / scored | Right | Wrong | Neutral |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...groups.map(
      (row) =>
        `| ${row.corpus} | ${row.lang} | ${row.rate} | ${row.count} | ${pct(row.before)} | ${pct(row.after)} | ${pct(row.oracle)} | ${row.changed}/${row.scored} (${pct(row.scored ? row.changed / row.scored : 0)}) | ${row.right} | ${row.wrong} | ${row.neutral} |`
    ),
    '',
    `Synthetic PER was **${pct(summary.synthetic.before)} → ${pct(summary.synthetic.after)}** (${pct(relative)} relative reduction, target 10%). Golden PER was **${pct(summary.golden.before)} → ${pct(summary.golden.after)}** (target no increase).`,
    '',
    'A right or wrong revision lowered or raised utterance PER when compared with the same final reading with only that region reverted. A neutral revision left PER unchanged.',
  ];
  writeReport('recognition-rescoring', lines.join('\n'), {
    weight: RESCORING_WEIGHT,
    summary,
    groups,
    rows,
  });
  return summary;
}

it('measures synthetic and golden IPA rescoring', () => {
  const limit = heavyLimit(Infinity);
  const rows = [];
  for (const lang of languages) {
    rows.push(...synthetic(lang, limit));
    console.log('rescoring heavy complete synthetic', lang);
  }
  rows.push(...golden(limit));
  write(rows, limit);
  for (const rate of rates) {
    const { before, after } = totals(
      rows.filter((row) => row.corpus === 'synthetic' && row.rate === rate)
    );
    assert.ok(
      after <= before,
      `Synthetic PER at ${rate} Hz rose from ${pct(before)} to ${pct(after)}`
    );
  }
});
