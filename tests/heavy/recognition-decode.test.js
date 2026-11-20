/** Phone and broad-class error on synthetic and golden speech. Unlicense. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { createVoiceFitter, errorRate, parseIpa } from '../../src/index.js';
import { phoneClass } from '../../src/recognition/decode-model.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  resultOf,
} from '../../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../../src/recognition/decode-search.js';
import {
  DECODER_VOICES,
  mean,
  plannedPhones,
  renderDecoderText,
} from '../helpers/decoder-material.js';
import { isReviewed, loadGolden } from '../helpers/golden.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const rates = [16000, 8000];
const templates = {
  en: [
    'Maya saw __.',
    'We brought __ home.',
    'The farmer found __.',
    'The children drew __.',
    'Did you find __?',
  ],
  ru: [
    'Мы увидели __.',
    'Она рисует __.',
    'Ребёнок нашёл __.',
    'Они обсуждали __.',
    'Ты видел __?',
  ],
  hi: [
    'बच्चे ने __ देखा।',
    'क्या आपने __ देखा?',
    'वह __ घर ले आया।',
    'हमने __ देखा।',
    'मीना ने __ बनाया।',
  ],
  zh: [
    '他看见了__。',
    '小孩画了__。',
    '我记得那个__。',
    '她想买__。',
    '你找到了__吗？',
  ],
};
const objects = {
  en: [
    'a red apple',
    'three flowers',
    'a blue cup',
    'the kitten',
    'a large pumpkin',
    'the missing key',
    'a small kite',
    'a yellow hat',
    'a new bell',
    'the brown basket',
  ],
  ru: [
    'кошку',
    'белку',
    'книгу',
    'сумку',
    'ложку',
    'корзину',
    'картину',
    'машину',
    'тёмную тучу',
    'странную птицу',
  ],
  hi: [
    'एक घर',
    'छोटा कुत्ता',
    'पुराना खिलौना',
    'लाल सेब',
    'नया पौधा',
    'पीला फूल',
    'रंगीन पतंग',
    'सफेद घोड़ा',
    'एक चित्र',
    'मिट्टी का घड़ा',
  ],
  zh: [
    '一只猫',
    '一朵红花',
    '一辆汽车',
    '一顶帽子',
    '一个苹果',
    '一张地图',
    '一把雨伞',
    '一只风筝',
    '一本书',
    '一只小鸟',
  ],
};

function broadClasses(phones) {
  return phones.map((ipa) => phoneClass(parseIpa(ipa).tokens[0]));
}

function decodeConditions(item, voice, rate) {
  const { samples, sampleRate, lang, phones } = item;
  const options = { voice, rate };
  const analysis = analyzeForDecode(
    samples,
    sampleRate,
    options,
    decoderSettings(sampleRate, options)
  );
  return [true, false].map((known) => {
    const settings = decoderSettings(sampleRate, {
      rate,
      language: known ? lang : undefined,
    });
    const { prepared, templates: phoneTemplates } = prepareIpaDecode(
      analysis,
      settings
    );
    const search = decodeSearch(prepared, settings.language, settings);
    const { ipa, segments } = resultOf(
      analysis,
      settings,
      prepared,
      phoneTemplates,
      search
    );
    const actual = segments
      .filter(({ kind }) => kind !== 'pause')
      .map(({ ipa: symbol }) => symbol);
    const phonesError = errorRate(phones, ipa, 'phone').rate;
    const classesError = errorRate(
      broadClasses(phones),
      broadClasses(actual),
      'phone'
    ).rate;
    assert.ok(Number.isFinite(phonesError) && Number.isFinite(classesError));
    return {
      rate,
      language: lang,
      known,
      phonesError,
      classesError,
      id: item.id,
      reviewed: item.reviewed,
    };
  });
}

function phoneTokens(ipa) {
  return parseIpa(ipa).tokens.filter(
    ({ kind }) => kind === 'vowel' || kind === 'consonant'
  );
}

function synthetic(rows, limit) {
  for (const [lang, patterns] of Object.entries(templates)) {
    const sentences = patterns.flatMap((pattern) =>
      objects[lang].map((name) => pattern.replace('__', name))
    );
    assert.equal(new Set(sentences).size, 50);
    for (const [index, sentence] of sentences.slice(0, limit).entries()) {
      const preset = index % 2 === 0 ? 'male' : 'female';
      const voice = DECODER_VOICES[preset];
      for (const sampleRate of rates) {
        const { plan, samples } = renderDecoderText(
          sentence,
          voice,
          sampleRate,
          lang
        );
        const phones = plannedPhones(plan).map(({ ipa }) => ipa);
        rows.push(
          ...decodeConditions(
            {
              id: `${lang}-${index + 1}`,
              lang,
              phones,
              samples,
              sampleRate,
            },
            voice,
            sampleRate
          ).map((metric) => ({
            ...metric,
            corpus: 'synthetic',
            speaker: preset,
          }))
        );
      }
    }
    console.log(
      'decoder heavy complete',
      lang,
      'synthetic',
      Math.min(sentences.length, limit)
    );
  }
}

function golden(rows, limit) {
  const items = loadGolden();
  const selected = items.slice(0, limit);
  for (const speaker of new Set(selected.map((item) => item.speaker.id))) {
    const recordings = items.filter((item) => item.speaker.id === speaker);
    const fitter = createVoiceFitter({
      refine: false,
      language: recordings[0].lang,
    });
    for (const item of recordings) {
      fitter.update(item.samples, item.sampleRate);
    }
    const { head } = fitter.result();
    for (const item of selected.filter((row) => row.speaker.id === speaker)) {
      const phones = phoneTokens(item.ipa).map(({ symbol }) => symbol);
      for (const rate of rates) {
        rows.push(
          ...decodeConditions(
            {
              ...item,
              phones,
              reviewed: isReviewed(item),
            },
            head,
            rate
          ).map((metric) => ({ ...metric, corpus: 'golden', speaker }))
        );
      }
    }
    console.log('decoder heavy complete', speaker, 'golden');
  }
}

function metric(rows) {
  return {
    phones: mean(rows.map(({ phonesError }) => phonesError)),
    classes: mean(rows.map(({ classesError }) => classesError)),
    count: rows.length,
  };
}

function pct(value) {
  return `${(100 * value).toFixed(2)}%`;
}

function write(rows) {
  const group = new Map();
  for (const row of rows) {
    const key = [
      row.corpus,
      row.language,
      row.rate,
      row.known ? 'given' : 'unspecified',
    ].join(' | ');
    if (!group.has(key)) {
      group.set(key, []);
    }
    group.get(key).push(row);
  }
  const measured = Object.fromEntries(
    [...group].sort().map(([name, items]) => [name, metric(items)])
  );
  const targets = { phones: 0.6, classes: 0.35 };
  const known = metric(
    rows.filter((row) => row.corpus === 'golden' && row.known)
  );
  const markdown = [
    '# Articulation-to-IPA decoder benchmark',
    '',
    'Run `node --test tests/heavy/recognition-decode.test.js` to reproduce. Phone and broad-class error are mean per-recording edit rates. For broad-class error, both strings are mapped from IPA to phoneme manner classes before alignment. The synthetic targets are from the waveguide plan. Golden speakers each have one head fitted without refinement from all their recordings, with the supplied IPA used only for scoring.',
    '',
    '<!-- prettier-ignore -->',
    '| Corpus | Language | Working rate (Hz) | Language input | Items | Phone error | Broad-class error |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: |',
    ...Object.entries(measured).map(
      ([name, { phones, classes, count }]) =>
        `| ${name} | ${count} | ${pct(phones)} | ${pct(classes)} |`
    ),
    '',
    `With the language given, the golden-set mean across both rates is **${pct(known.phones)}** phone error and **${pct(known.classes)}** broad-class error. The research targets are ${pct(targets.phones)} and ${pct(targets.classes)}, respectively.`,
    '',
    'Long-term reference: **32.7%** phone error for the trained Kaldi monophone recognizer on the 39-phone TIMIT core test set. [Kaldi TIMIT results](https://github.com/kaldi-asr/kaldi/blob/master/egs/timit/s5/RESULTS)',
    '',
    `Golden references reviewed by a speaker: ${new Set(rows.filter((row) => row.corpus === 'golden' && row.reviewed).map(({ id }) => id)).size} of ${new Set(rows.filter((row) => row.corpus === 'golden').map(({ id }) => id)).size}.`,
  ].join('\n');
  writeReport('recognition-decode', markdown, {
    targets,
    golden: known,
    measured,
    rows,
  });
}

it('measures synthetic and golden phoneme recognition', () => {
  const rows = [];
  const limit = heavyLimit(Infinity);
  synthetic(rows, limit);
  golden(rows, limit);
  write(rows);
});
