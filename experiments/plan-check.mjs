// Print a compact plan summary for a phrase: segments and sampled channels.
import { planUtterance } from '../src/articulation/plan.js';
import { textToIpa } from '../src/g2p/index.js';

const text = process.argv[2] ?? 'Hello world, how are you?';
const { ipa, lang } = textToIpa(text);
const plan = planUtterance(ipa, { language: lang });
console.log(lang, ipa, plan.duration.toFixed(3), 's', plan.frameCount);
for (const s of plan.segments) {
  console.log(
    s.kind.padEnd(9),
    (s.token?.symbol ?? '-').padEnd(4),
    s.start.toFixed(3),
    s.duration.toFixed(3)
  );
}
const show = ['height', 'backness', 'tongueArea', 'lipArea', 'voicing', 'f0'];
for (let f = 0; f < plan.frameCount; f += 10) {
  console.log(
    (f / plan.frameRate).toFixed(2),
    show.map((n) => `${n}=${plan.channels[n][f].toFixed(2)}`).join(' ')
  );
}
