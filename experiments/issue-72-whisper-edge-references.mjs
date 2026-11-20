/** Compare phrase-edge and medial reference phones on held-out audio. Unlicense. */
import { errorRate, ipaToText } from '../src/index.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  resultOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import {
  renderWhisperReference,
  whisperDistance,
  WHISPER_WEIGHTS,
} from '../src/recognition/whisper-decode.js';
import { whisperSpectrum } from '../src/recognition/whisper-spectrum.js';
import { plannedPhones } from '../tests/helpers/decoder-material.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

const POINTS = [0.1, 0.3, 0.5, 0.7, 0.9];
const strip = (ipa) => ipa.replace(/[ˈˌ˥˦˧˨˩]/gu, '');
const asPhones = (segments) => segments.map(({ ipa }) => strip(ipa)).join(' ');

function alternatives(templates, settings, voice, leading) {
  return templates.map(({ ipa, kind }) => {
    const contexts = kind === 'vowel' ? ['', 'm', 'p'] : ['a', 'i', 'u'];
    return contexts.map((context) =>
      renderWhisperReference(
        ipa,
        settings,
        voice,
        leading ? ['', context] : [context, '']
      )
    );
  });
}

function rescore(prepared, frames, templates, settings, voice) {
  const { times, spans } = prepared;
  const start = times[0];
  const end = times.at(-1);
  const front = alternatives(templates, settings, voice, true);
  const back = alternatives(templates, settings, voice, false);
  const spectrum = whisperSpectrum(frames, 0, frames.sampleCount / frames.rate);
  const width = frames.melBands + 1;
  const input = new Float32Array(POINTS.length * width);
  return {
    times,
    spans: spans.map((arcs, from) =>
      arcs.map((arc) => {
        const left = times[from];
        const right = times[arc.to];
        const table =
          left - start <= 0.07 ? front : end - right <= 0.07 ? back : null;
        if (!table || !arc.whisper) {
          return arc;
        }
        const duration = right - left;
        for (const [i, point] of POINTS.entries()) {
          spectrum.sample(left + point * duration, input, i * width);
        }
        const terms = arc.terms.slice();
        templates.forEach(({ kind }, unit) => {
          const cell = unit * 3;
          let best = terms[cell] + WHISPER_WEIGHTS.duration * terms[cell + 1];
          for (const { values, duration: nominal } of table[unit]) {
            const timing = 2 * Math.log(duration / nominal) ** 2;
            const acoustic =
              8 *
                duration *
                whisperDistance(input, values, width, kind === 'vowel') +
              0.85;
            const score = acoustic + WHISPER_WEIGHTS.duration * timing;
            if (score < best) {
              best = score;
              terms[cell] = acoustic;
              terms[cell + 1] = timing;
            }
          }
        });
        return { ...arc, terms };
      })
    ),
  };
}

const totals = [0, 0];
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
  const end = samples.length / sampleRate;
  const options = { language, voice: head, whisper: [{ start: 0, end }] };
  const settings = decoderSettings(sampleRate, options);
  const analysis = analyzeForDecode(samples, sampleRate, options, settings);
  const { prepared, templates } = prepareIpaDecode(analysis, settings);
  const reference = asPhones(plannedPhones(plan));
  const variants = [
    prepared,
    rescore(prepared, analysis.frames, templates, settings, analysis.voice),
  ];
  for (const [index, scored] of variants.entries()) {
    const search = decodeSearch(scored, settings.language, {
      ...settings,
      lattice: false,
    });
    const result = resultOf(analysis, settings, scored, templates, search);
    const { distance, referenceLength } = errorRate(
      reference,
      asPhones(result.segments),
      'phone'
    );
    totals[index] += distance;
    console.log(
      language,
      text,
      index,
      distance,
      referenceLength,
      result.ipa,
      ipaToText(result.segments, { language }).text
    );
  }
}
console.log(totals);
