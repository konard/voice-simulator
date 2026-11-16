// Type check of the engine declarations of src/index.d.ts (issue 25):
// npx -p typescript tsc --noEmit --strict --target es2022 --module nodenext \
//   --allowImportingTsExtensions experiments/issue-25-types.ts
import {
  ENGINE_NAMES,
  Engine,
  createEngine,
  getEngine,
  loadEngineModuleSync,
  planUtterance,
  synthesize,
  measureAudioTier,
  AUDIO_TIERS,
  type EngineName,
} from '../src/index.js';
import { createVoiceServer } from '../src/server/server.js';

async function main(): Promise<void> {
  const names: readonly EngineName[] = ENGINE_NAMES;
  const engine: Engine = await createEngine({ engine: 'auto', threads: 1 });
  const same: Engine = getEngine(engine);
  const plan = planUtterance('həˈloʊ');
  const renderer = engine.createRenderer(plan, { solver: 'waveguide' });
  const which: 'rust' | 'js' = renderer.engine;
  const reason: string | null = renderer.fallbackReason;
  const result = synthesize('Hi.', { engine: 'js', simd: false });
  const load: number = measureAudioTier(AUDIO_TIERS[0], { engine: same });
  const module = loadEngineModuleSync(undefined, { simd: 'auto' });
  const options = createVoiceServer({ engine: 'rust' });
  console.log(names, which, reason, result.duration, load, module, options);
}
void main();
