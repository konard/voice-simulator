/** Compare acoustic phone boundary priors on short synthetic phrases. Unlicense. */
import { errorRate, ipaToText } from '../src/index.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  resultOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { whisperSpectrum } from '../src/recognition/whisper-spectrum.js';
import { plannedPhones } from '../tests/helpers/decoder-material.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

const strip = (ipa) => ipa.replace(/[ˈˌ˥˦˧˨˩]/gu, '');
const asPhones = (segments) => segments.map(({ ipa }) => strip(ipa)).join(' ');
const variants = [0, 0.25, 0.5, 1, 2];
const totals = variants.map(() => ({ edits: 0, phones: 0 }));

function boundaryEvidence(spectrum, times, width, duration) {
  const before = new Float32Array(width);
  const after = new Float32Array(width);
  return times.map((time) => {
    spectrum.sample(Math.max(0, time - 0.03), before, 0);
    spectrum.sample(Math.min(duration, time + 0.03), after, 0);
    const spectral = before
      .subarray(0, width - 1)
      .reduce((sum, v, i) => sum + (v - after[i]) ** 2, 0);
    const level = (before[width - 1] - after[width - 1]) / 13;
    return Math.max(0, Math.sqrt(spectral / (width - 1) + level ** 2) - 0.6);
  });
}

function adjustBoundaryCosts(spans, credit) {
  for (const span of spans) {
    if (span.whisper) {
      for (let term = 0; term < span.terms.length; term += 3) {
        span.terms[term] -= credit;
      }
    }
  }
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
  const end = samples.length / sampleRate;
  const options = { language, voice: head, whisper: [{ start: 0, end }] };
  const settings = decoderSettings(sampleRate, options);
  const analysis = analyzeForDecode(samples, sampleRate, options, settings);
  const { prepared, templates } = prepareIpaDecode(analysis, settings);
  const { times } = prepared;
  const { frames } = analysis;
  const evidence = boundaryEvidence(
    whisperSpectrum(frames, 0, end),
    times,
    frames.melBands + 1,
    end
  );
  const reference = asPhones(plannedPhones(plan));
  let previous = 0;
  for (const [i, weight] of variants.entries()) {
    for (const [from, spans] of prepared.spans.entries()) {
      adjustBoundaryCosts(spans, (weight - previous) * evidence[from]);
    }
    previous = weight;
    const search = decodeSearch(prepared, settings.language, {
      ...settings,
      lattice: false,
    });
    const { ipa, segments } = resultOf(
      analysis,
      settings,
      prepared,
      templates,
      search
    );
    const { distance, referenceLength } = errorRate(
      reference,
      asPhones(segments),
      'phone'
    );
    totals[i].edits += distance;
    totals[i].phones += referenceLength;
    const lexical = ipaToText(segments, { language }).text;
    console.log(
      language,
      text,
      weight,
      distance,
      referenceLength,
      ipa,
      lexical
    );
  }
}
console.log(totals);
