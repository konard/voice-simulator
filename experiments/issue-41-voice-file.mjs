// Loads and saves voices in every form and prints the problems found
// (issue 41): node experiments/issue-41-voice-file.mjs
import { loadVoice, saveVoice } from '../src/voice-file.js';
import { encodeHeadConfig, randomHeadConfig } from '../src/head-config.js';

const file = {
  format: 'voice-simulator/voice',
  version: 1,
  name: 'Anna',
  preset: 'female',
  folds: { pitch: 205 },
};
const voice = loadVoice(file);
console.log('loaded:', voice.name, voice.preset, voice.head.pitch);
console.log('saved:', JSON.stringify(saveVoice(voice)));
const head = randomHeadConfig(3);
console.log(
  'query round trip:',
  JSON.stringify(loadVoice(encodeHeadConfig(head)).head) ===
    JSON.stringify(head)
);
console.log(
  'flat round trip:',
  JSON.stringify(loadVoice(head).head) === JSON.stringify(head)
);
const broken = {
  format: 'other',
  version: 2,
  preset: 'robot',
  mouth: {},
  folds: { pitch: 900, vocalTractLength: 15, jitterx: 1, shimmer: 'a' },
};
try {
  loadVoice(broken);
} catch (error) {
  console.log(`strict:\n${error.message}`);
}
const lenient = loadVoice(broken, { strict: false });
console.log(
  'lenient pitch',
  lenient.head.pitch,
  'vtl',
  lenient.head.vocalTractLength,
  'warnings',
  lenient.warnings.length
);
