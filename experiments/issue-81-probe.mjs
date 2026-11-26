// Quick probe of 8 kHz synthesis and recognition (issue 81). Unlicense.
import { synthesize, recognize } from '../src/index.js';
const cpu = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1e6;
};
for (const tier of ['telephone', 'wideband']) {
  let t = cpu();
  const out = synthesize(process.argv[2] ?? 'Hello world.', {
    tier,
    engine: 'js',
  });
  const synth = cpu() - t;
  const dur = out.samples.length / out.sampleRate;
  let peak = 0;
  for (const s of out.samples) {
    peak = Math.max(peak, Math.abs(s));
  }
  t = cpu();
  const heard = recognize(out.samples, out.sampleRate, {
    level: 'low',
    engine: 'js',
  });
  const rec = cpu() - t;
  console.log(
    tier,
    out.sampleRate,
    dur.toFixed(2),
    'peak',
    peak.toFixed(3),
    'synthRTF',
    (synth / dur).toFixed(3),
    'recRTF',
    (rec / dur).toFixed(3),
    JSON.stringify(heard.text),
    'rss',
    process.resourceUsage().maxRSS / 1024
  );
}
