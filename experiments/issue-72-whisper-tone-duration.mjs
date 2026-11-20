/** Check duration calibration on multiple Mandarin vowels and tone orders. Unlicense. */
import { analyzeFrames, presetHeadConfig, synthesize } from '../src/index.js';
import { bestTone, mean } from '../src/recognition/prosody-features.js';
import { whisperTones } from '../src/recognition/whisper.js';
import { syllableTone } from '../tests/helpers/prosody-material.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

const tones = ['˥', '˧˥', '˨˩˦', '˥˩', ''];
const presets = ['male', 'female'];
const carriers = ['mi', 'wu', 'kɤ'];
const toneGroups = ['衣 姨 椅 意', '乌 无 五 误', '歌 格 葛 个'];
const evaluation = '妈 麻 马 骂';

function listen({ samples, sampleRate, timeline, plan }) {
  const frames = analyzeFrames(samples, sampleRate);
  const meanDuration = mean(
    timeline.words.map(({ end, start }) => end - start)
  );
  return timeline.words.map((word, index) => {
    const vowel = plan.segments.find(
      ({ kind, start }) => kind === 'vowel' && start >= word.start - 1e-9
    );
    const tone = syllableTone(word.ipa);
    return {
      tone: tone === '˨˩' ? '˨˩˦' : tone,
      final: index === timeline.words.length - 1,
      relative: (word.end - word.start) / meanDuration,
      scores: whisperTones(frames, {
        ...word,
        vowelStart: vowel.start,
        meanDuration,
      }),
    };
  });
}

function calibrate(preset) {
  return carriers.flatMap((carrier) =>
    tones.flatMap((_, position) => {
      const syllables = tones.slice(position).concat(tones.slice(0, position));
      const ipa = syllables
        .map(
          (tone, i) =>
            carrier + (tone === '˨˩˦' && i < syllables.length - 1 ? '˨˩' : tone)
        )
        .join(' ');
      return listen(
        synthesize(`{W ${ipa} W}`, {
          ipa: true,
          lang: 'zh',
          head: presetHeadConfig(preset),
          tier: 'minimal',
          seed: 1,
          engine: 'js',
        })
      );
    })
  );
}

function fit(probes, final) {
  return tones.map((tone) => {
    const matching = probes.filter(
      (probe) =>
        probe.tone === tone && (final === undefined || probe.final === final)
    );
    return mean(matching.map(({ relative }) => relative));
  });
}

const ipaTraining = presets.flatMap(calibrate);
const textTraining = presets.flatMap((preset) =>
  toneGroups.flatMap((group) => {
    const words = group.split(' ');
    return words.flatMap((_, index) => {
      const sequence = words
        .slice(index)
        .concat(words.slice(0, index))
        .join(' ');
      return listen(renderWhisper(`[whisper] ${sequence}`, 'zh', preset));
    });
  })
);
// Use the spoken text sequences for the four full tones, and the matched
// IPA carriers to measure the effect of removing tone on neutral syllables.
const training = [...textTraining, ...ipaTraining.filter(({ tone }) => !tone)];
console.log({
  tones,
  medial: fit(training, false),
  final: fit(training, true),
});

for (const [source, probes] of [
  ['calibration', training],
  [
    'held out',
    presets.flatMap((preset) =>
      listen(renderWhisper(`[whisper] ${evaluation}`, 'zh', preset))
    ),
  ],
]) {
  const correct = probes.filter(
    ({ tone, scores }) => bestTone(scores) === tone
  ).length;
  console.log({ source, total: probes.length, correct });
}
