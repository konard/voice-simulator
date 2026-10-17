import { textToIpa, detectLanguage } from '../src/g2p/index.js';
import { parseIpa } from '../src/ipa/parse.js';
import {
  randomHeadConfig,
  encodeHeadConfig,
  decodeHeadConfig,
} from '../src/head-config.js';
for (const t of [
  'Hello world',
  'Привет, мир',
  'नमस्ते दुनिया',
  '你好世界',
  'ni3 hao3',
  'I have 3 cats.',
]) {
  console.log(
    t,
    JSON.stringify(detectLanguage(t)),
    JSON.stringify(textToIpa(t))
  );
}
console.log(parseIpa('ˈtʰæ̃ː').tokens);
const h = randomHeadConfig('abc');
console.log(h, encodeHeadConfig(h), decodeHeadConfig(encodeHeadConfig(h)));
