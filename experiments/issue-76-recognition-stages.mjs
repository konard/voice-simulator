/** Compare the medium acoustic output and dictionary controls on FLEURS. */
import { textToIpa } from '../src/g2p/index.js';
import { audioToIpa } from '../src/recognition/decode.js';
import { ipaToText } from '../src/recognition/ipa-to-text.js';
import { identifyLanguage } from '../src/recognition/language-id.js';
import { recognize, RecognitionError } from '../src/recognition/recognizer.js';
import {
  BENCHMARK,
  loadBenchmark,
  prepareReference,
  scoreUtterance,
} from '../tests/heavy/helpers/benchmark.js';

function measureRow(row, language, reference) {
  let acousticIpa = '';
  let result = {};
  try {
    result = recognize(row.samples, row.sampleRate, {
      level: 'medium',
      stages: {
        audioToIpa(samples, rate, options) {
          const decoded = audioToIpa(samples, rate, {
            ...options,
            sourceRate: row.sampleRate,
          });
          acousticIpa = decoded.ipa;
          return decoded;
        },
      },
    });
  } catch (error) {
    if (
      !(error instanceof RecognitionError) ||
      !['empty', 'too-noisy'].includes(error.code)
    ) {
      throw error;
    }
  }
  const dictionaryIpa = textToIpa(row.text, { lang: language }).ipa;
  const acoustic = scoreUtterance(row, { ipa: acousticIpa }, language, {
    reference,
  });
  const endToEnd = scoreUtterance(row, result, language, { reference });
  const dictionary = scoreUtterance(
    row,
    {
      ...ipaToText(dictionaryIpa, { language }),
      ...identifyLanguage(dictionaryIpa),
    },
    language,
    { reference }
  );
  return {
    acousticPer: acoustic.per.errors,
    acousticClass: acoustic.classErr.errors,
    endToEndPer: endToEnd.per.errors,
    endToEndClass: endToEnd.classErr.errors,
    endToEndCer: endToEnd.cer.errors,
    dictionaryCer: dictionary.cer.errors,
    endToEndLanguage: Number(endToEnd.languageRight),
    dictionaryLanguage: Number(dictionary.languageRight),
    phones: acoustic.per.length,
    characters: endToEnd.cer.length,
  };
}

for (const set of BENCHMARK.sets.filter(({ id }) => id.startsWith('fleurs-'))) {
  const totals = { utterances: 0 };
  for (const row of await loadBenchmark({ set, limit: 5 })) {
    const reference = prepareReference(row, set.language);
    if (reference === null) {
      continue;
    }
    totals.utterances++;
    for (const [key, count] of Object.entries(
      measureRow(row, set.language, reference)
    )) {
      totals[key] = (totals[key] ?? 0) + count;
    }
  }
  console.log(JSON.stringify({ set: set.id, ...totals }));
}
