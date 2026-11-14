---
id: P13
title: Rust engine in a background worker as the default, JavaScript as the fallback
type: Feature
milestone: M1
blocked_by: [P10, P11]
requirements: [R2, R12, R13]
---

## Goal

Add `src/engine/index.js` with `createEngine({ engine: 'auto' | 'rust' |
'js' })`, give every synthesis function the option `engine`, add the CLI
flag `--engine`, move the synthesis worker from the example app into the
library, and make `'auto'` the default: the Rust engine (WebAssembly) renders
when it can be loaded, the JavaScript engine renders in every other case
with no error and no missing feature.

## Why

R2: "Rust background worker should be used by default". After {{P10}} and
{{P11}} the Rust code exists but nothing uses it. This issue is the switch.
R13 needs the fallback: a device where WebAssembly cannot be loaded must
still speak.

## Current state

- There is no folder `src/engine/` and no option `engine`. `src/synthesize.js`
  exports `prepareUtterance`, `synthesize` (synchronous, calls
  `renderPlan`), `synthesizeAsync` (`renderPlanAsync`) and `synthesizeStream`
  (`new VoiceRenderer`, then `renderAsync` per chunk of 4096 samples).
  `src/perf/benchmark.js` also creates a `VoiceRenderer` (line 24).
- The command line (`bin/voice-simulator.js` line 266) and the server
  (`src/server/server.js` line 273) call the synchronous `synthesize`; the
  server streams with `synthesizeStream` (line 214).
- The only worker is in the example app:
  `examples/universal-app/src/engine/synth-worker.js` (337 lines). It imports
  only from `src/index.js`. Its messages are listed at the top of that file:
  in `benchmark`, `speak`, `cancel`; out `benchmark`, `start`, `overload`,
  `chunk`, `end`, `error`. `voice-engine.js` line 68 starts it with
  `new Worker(new URL('./synth-worker.js', import.meta.url), {type:
'module'})`.
- `package.json`: `"exports"` has `"."` and `"./server"`; `"files"` contains
  `src/`, so a file in `src/engine/` is published when it exists at publish
  time. {{P09}} git-ignores `src/engine/*.wasm` and lets CI build it.
- Solvers are chosen by name from `SOLVERS` in `voice.js`; `registerSolver`
  lets a user add one. The option `device` runs the 3D solver on WebGPU.

## What to do

1. `src/engine/index.js` exports `createEngine(options)` (async) and
   `getEngine(options)` (synchronous). Options: `engine` (`'auto'`, the
   default, `'rust'` or `'js'`), `threads` (1 by default, a positive integer
   or `'auto'`), `simd` (`'auto'` by default, `true` or `false`) and
   `source`; the last three are passed to `loadEngineModule` unchanged.
   Until {{P12}} is merged the loader ignores `threads` and the engine
   reports `threads: 1`; that is correct, do not add thread code here.
   - `'js'`: never loads WebAssembly.
   - `'auto'`: loads the module; if `loadEngineModule` returns `null`, the
     result is the JavaScript engine with `reason` set.
   - `'rust'`: the same, but a module that does not load is an error with
     `code = 'ENGINE_UNAVAILABLE'`.
   - Engines are cached by `engine|threads|simd`; a second call returns the
     same object.
   - `getEngine` returns the cached engine. Without one it loads
     synchronously where it can: when `globalThis.process?.getBuiltinModule`
     is a function it reads the file with `readFileSync` of `node:fs` and
     uses `new WebAssembly.Module` and `new WebAssembly.Instance`. Where it
     cannot (browsers), `'auto'` gives the JavaScript engine and `'rust'`
     throws `ENGINE_UNAVAILABLE` with the message
     `call await createEngine() first`.
2. The engine object: `name` (`'rust'` or `'js'`), `requested`, `simd`
   (boolean), `threads` (number), `reason` (`null` or why JavaScript is
   used), `features()` (empty list here; {{P70}} fills it),
   `supports(renderOptions)` (`null` or a reason),
   `createRenderer(plan, renderOptions)` and `close()`.
   `createRenderer` returns a `RustVoiceRenderer` when `name` is `'rust'`
   and `supports` returns `null`; otherwise a `VoiceRenderer`. The renderer
   gets two fields: `engine` (`'rust'` or `'js'`) and `fallbackReason`.
   `supports` returns a reason for: a `solver` that is not `'waveguide'` or
   `'fdtd3d'`, a `device`, and any option for which `RustVoiceRenderer`
   throws `ENGINE_UNSUPPORTED`. Such a render goes to JavaScript also under
   `'rust'`; {{P70}} removes these cases one by one.
3. `src/acoustics/voice.js`: `renderPlan` and `renderPlanAsync` take
   `options.engine` (a name or an engine object, default `'auto'`), resolve
   it (`getEngine` in `renderPlan`, `await createEngine` in
   `renderPlanAsync`) and call `engine.createRenderer`. `prepareUtterance`
   copies `options.engine`, `options.threads` and `options.simd` into
   `renderOptions`. `synthesizeStream` and `benchmarkRenderer` create their
   renderer the same way. `new VoiceRenderer(...)` stays the JavaScript
   renderer.
4. Command line: add `engine: { type: 'string' }` and
   `threads: { type: 'string' }` to `OPTIONS`. `--engine` accepts `auto`,
   `rust`, `js`; another value prints
   `Unknown engine: <value> (auto, rust, js)` and exits with 1. `main` calls
   `await createEngine(...)` once before the command runs. `benchmark
--json` gets the field `engine`; the text form prints `engine: <name>` as
   the first line. The help text lists both flags. No native addon:
   Node.js, Bun and Deno run the same `.wasm` file.
5. Server: `createVoiceServer({ engine })` creates the engine once (default
   `'auto'`), passes it to every `synthesize` and `synthesizeStream` call,
   and `GET /api/tiers` gets the field `engine` (the name in use). The query
   parameter `engine=js` selects JavaScript for one request; other values
   give HTTP 400.
6. Worker in the library:
   - `src/engine/worker-protocol.js` exports
     `createWorkerHandler(post, options)`. It returns
     `async handle(message)`. Move the body of the app's `synth-worker.js`
     into it without changing any message. Additions: the incoming `speak`
     and `benchmark` messages may carry `engine`, `threads`, `simd`; the
     `start` message gets `engine` and `fallbackReason`; a new incoming
     message `{type: 'engine'}` is answered with
     `{type: 'engine', name, simd, threads, reason}`.
   - `src/engine/worker.js` is the entry:
     `const handle = createWorkerHandler((m, t) => self.postMessage(m, t));`
     `self.onmessage = (event) => handle(event.data);`. Add
     `"./worker": "./src/engine/worker.js"` to `"exports"`.
   - The app's `synth-worker.js` becomes one line:
     `import '../../../../src/engine/worker.js';`. `voice-engine.js` sends
     `{type: 'engine'}` after it creates the worker and shows the answer in
     the settings panel as "Engine: Rust (SIMD)" or
     "Engine: JavaScript (<reason>)". Add a setting "Engine" with the values
     Auto, Rust, JavaScript, stored like the other settings.
7. Type declarations (`src/index.d.ts`): the option `engine`, the function
   `createEngine`, the engine object. Export `createEngine` and `getEngine`
   from `src/index.js`.
8. Size budget. Build the app (`npm run example:web:build`) before and
   after. Record both totals (`du -sb examples/universal-app/dist`) and the
   gzip size of each `.wasm` file in the pull request. The JavaScript added
   to the main bundle of the app must be below 20 000 bytes before gzip. Add
   the check `tests/engine-size.test.js`: every file
   `src/engine/*.wasm` that exists is at most its `WASM_SIZE_BUDGET` of
   {{P09}}.
9. Documentation: `docs/RUST-ENGINE.md` gets the sections "Choosing an
   engine" (the three values, what `'auto'` does in Node.js and in a
   browser, the note that the two engines may differ by up to 1e-4 per
   sample so `engine: 'js'` is the value for byte-stable output without the
   `.wasm` file) and "Worker" (the message list). `README.md` gets a short
   "Engines" section and the flag.

## Tests

`tests/engine.test.js` (tests that need the binary use `noRust` of
{{P09}}):

- `js engine never loads WebAssembly`: with a `source` that throws when
  read, `createEngine({engine: 'js'})` resolves with `name === 'js'`.
- `auto falls back`: `createEngine({engine: 'auto', source: new
Uint8Array([0, 1, 2])})` resolves with `name === 'js'` and a non-empty
  `reason`; `synthesize('Hi.', {engine, tier: 'minimal'})` returns audio
  with a peak above 0.01.
- `rust is an error when it cannot load`: the same source with
  `engine: 'rust'` rejects with `code === 'ENGINE_UNAVAILABLE'`.
- `auto uses Rust`: `synthesize('Hello.', {tier: 'minimal', seed: 1})`
  reports a renderer with `engine === 'rust'`; the largest sample difference
  to `engine: 'js'` is below 1e-4.
- `unsupported renders go to JavaScript`: a solver added with
  `registerSolver('test-tube', ...)` renders under `engine: 'rust'` with
  `fallbackReason` set.
- `engines are cached`: two calls of `createEngine()` return the same
  object.
- `unknown engine is rejected`: `createEngine({engine: 'x'})` rejects with
  `Unknown engine: x`.

`tests/engine-worker.test.js` (no real worker; `post` collects messages):

- `speak streams chunks`: a `speak` message (`ipa` `'həˈloʊ'`, tier 0)
  gives `start`, at least one `chunk`, then `end`; `start.engine` is
  `'rust'` or `'js'`.
- `engine message answers`: `{type: 'engine'}` gives one `engine` message.
- `cancel stops`: `cancel` after the first chunk; no `end` for that id.

`tests/cli-audio.test.js` additions (use its helper `cli(argv)`):
`--engine js` and `--engine rust` write WAV files of equal length;
`--engine nope` exits with 1.

## Acceptance criteria

- [ ] `node bin/voice-simulator.js benchmark --json` prints
      `"engine": "rust"` after `npm run build:wasm`, and `"engine": "js"`
      after the `.wasm` files are deleted; both runs exit with 0.
- [ ] `npm test` passes with and without the `.wasm` files; with them and
      `REQUIRE_WASM=1` no engine test is skipped.
- [ ] `npm pack --dry-run` in the CI job that publishes lists
      `src/engine/voice-simulator.wasm`.
- [ ] The built app shows "Engine: Rust" in a current Chrome and Firefox; a
      screenshot is in the pull request. With the `.wasm` request blocked in
      the developer tools the app speaks and shows "Engine: JavaScript".
- [ ] `tests/heavy/performance-tiers.test.js` run with `engine: 'js'` and
      `'rust'`: Rust is not slower on any tier; the table is in the pull
      request.
- [ ] The size numbers of step 8 are in the pull request and the 20 000 byte
      limit holds.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Removing the JavaScript engine. It stays the reference and the fallback.
- Threads as the default: `threads` stays 1 here ({{P12}} measures them).
- Playback, the load-time benchmark and quality changes during an
  utterance: {{P15}}, {{P16}}, {{P17}}.
- Features that exist only in JavaScript: {{P70}}. Recognition in Rust:
  {{P65}} (it must use `createEngine`, not a second loader).
- A native Node.js addon.

## References

- Vite, "Features" (assets referenced with `new URL(..., import.meta.url)`
  and workers), https://vite.dev/guide/features
- Deno, "WebAssembly", https://docs.deno.com/runtime/reference/wasm/
- `docs/RUST-ENGINE.md` (created by {{P09}}).
- Research note `docs/case-studies/issue-11/research/5-performance-and-physics.md`,
  section 1.
