/** Profile a bounded 8 kHz live session. Unlicense. */
import {
  createVoiceSession,
  presetHeadConfig,
  synthesize,
} from '../src/index.js';

const [preset = 'male', duration = '4', modeLabels, engine = 'js'] =
  process.argv.slice(2);
const seconds = Number(duration);
if (!(seconds > 0 && seconds <= 20)) {
  throw new RangeError('Use up to 20 seconds');
}
const { samples, sampleRate } = synthesize(
  'A little bird sings in the morning. We heard it again across the green field. The road climbed slowly through the forest toward a house beside the river.',
  { tier: 'telephone', seed: 1, head: presetHeadConfig(preset) }
);
const start = process.cpuUsage();
const session = createVoiceSession({
  sampleRate,
  languages: ['en'],
  level: 'low',
  realtime: true,
  ...(modeLabels !== undefined && { includeModeLabels: modeLabels === 'true' }),
  engine,
  backgroundShare: Number(process.env.SESSION_BACKGROUND_SHARE ?? 0.25),
});
session.on('state', (state) => console.log(state));
session.on('error', (error) => {
  throw error;
});
const input = samples.subarray(0, Math.round(seconds * sampleRate));
const chunk = sampleRate / 50;
for (let i = 0; i < input.length; i += chunk) {
  session.push(input.subarray(i, i + chunk));
}
const result = session.flush();
console.log(session.state, result.text, process.cpuUsage(start));
