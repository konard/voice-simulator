/** Separate whisper detection, boundary and acoustic errors. Unlicense. */
import { audioToIpa, errorRate, ipaToText } from '../src/index.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  resultOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { decoderTemplates } from '../src/recognition/decode-model.js';
import {
  createWhisperScorer,
  WHISPER_WEIGHTS,
} from '../src/recognition/whisper-decode.js';
import { plannedPhones } from '../tests/helpers/decoder-material.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

const removeMarks = (ipa) => ipa.replace(/[ˈˌ˥˦˧˨˩]/gu, '');
const phones = (segments) => segments.map(({ ipa }) => removeMarks(ipa));

function oracleSearch(analysis, settings, reference) {
  const templates = decoderTemplates(analysis.voice, settings.language.symbols);
  const score = createWhisperScorer(
    analysis.frames,
    analysis.whisperSpans,
    templates,
    settings,
    analysis.voice
  );
  return reference.map(({ start, end }) => {
    const { terms } = score(start, end);
    let best = Infinity;
    let phone = '';
    for (const [index, { ipa }] of templates.entries()) {
      const cost =
        terms[index * 3] + WHISPER_WEIGHTS.duration * terms[index * 3 + 1];
      if (cost < best) {
        best = cost;
        phone = ipa;
      }
    }
    return phone;
  });
}

for (const [language, text] of [
  ['en', 'she sees five sheep'],
  ['ru', 'Саша шла домой.'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '请喝茶'],
  ['en', 'hello world'],
  ['en', 'a big dog'],
]) {
  const { samples, sampleRate, plan, head } = renderWhisper(
    `[whisper] ${text}`,
    language
  );
  const reference = plannedPhones(plan);
  const options = { language, voice: head };
  const automatic = audioToIpa(samples, sampleRate, options);
  const end = samples.length / sampleRate;
  const forced = { ...options, whisper: [{ start: 0, end }] };
  const settings = decoderSettings(sampleRate, forced);
  const analysis = analyzeForDecode(samples, sampleRate, forced, settings);
  const decode = (bounds) => {
    const { prepared, templates } = prepareIpaDecode(
      analysis,
      settings,
      bounds
    );
    const search = decodeSearch(prepared, settings.language, settings);
    return resultOf(analysis, settings, prepared, templates, search);
  };
  const exactStartEnd = decode({
    from: reference[0].start,
    to: reference.at(-1).end,
  });
  const exactPhones = oracleSearch(analysis, settings, reference);
  const expected = phones(reference).join(' ');
  const score = (hypothesis) =>
    errorRate(expected, hypothesis.join(' '), 'phone').distance;
  const report = ({ segments }) => {
    const hypothesis = phones(segments);
    return {
      edits: score(hypothesis),
      phones: hypothesis,
      text: ipaToText(segments, { language }).text,
    };
  };
  console.log(
    JSON.stringify({
      language,
      text,
      reference: expected,
      automatic: report(automatic),
      forced: report(decode()),
      exactStartEnd: report(exactStartEnd),
      exactPhones: { edits: score(exactPhones), phones: exactPhones },
    })
  );
}
