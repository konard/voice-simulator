// Probe how the text front end reads the forms say-as could produce.
import { textToIpa } from '../src/g2p/index.js';
const lines = process.argv.slice(2);
for (const t of lines.length ? lines : ['A.B.C.', 'ABC', 'A. B. C.', 'a.b.c', 'NASA', 'N.A.S.A.', 'Z', 'A-B-C', 'А.Б.В.', 'x1', 'abc1', '1 2 3', '2nd', '3th'])
  console.log(JSON.stringify(t), '=>', textToIpa(t).ipa);
