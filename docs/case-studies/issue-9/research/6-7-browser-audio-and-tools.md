## 6. Browser audio in background tabs

### 6.1 The `"interrupted"` AudioContext state

**Spec status.** The Web Audio API 1.1 Editor's Draft (dated 9 Sep 2026) now defines `enum AudioContextState { "suspended", "running", "closed", "interrupted" }`. It describes `"interrupted"` as "currently interrupted and cannot process audio until the interruption ends" ([ED](https://webaudio.github.io/web-audio-api/#dom-audiocontextstate-interrupted)). §2.7 says the user agent _may_ create an interruption, "for example … when another application requests exclusive access to the audio output hardware" ([§2.7](https://webaudio.github.io/web-audio-api/)). When the interruption ends, the UA puts the context back into whatever state it was in before. It fires `statechange` on the way out of a running context. It does **not** fire one when a suspended context is interrupted, "for privacy reasons … e.g. when a phone call comes in or when the screen gets locked" ([§2.7](https://webaudio.github.io/web-audio-api/)).

- History: the proposal was [WebAudio/web-audio-api#2392](https://github.com/WebAudio/web-audio-api/issues/2392), opened by rtoy in Jan 2021 and building on #72. It was closed as completed on 12 May 2025, with the comment "fixed by #2611". PR #2611, "AudioContext 'interrupted' state", is shown as closed via the [GitHub API](https://api.github.com/repos/WebAudio/web-audio-api/pulls/2611). The ED text above confirms the change is in the spec.
- The W3C TAG review was [w3ctag/design-reviews#1069](https://github.com/w3ctag/design-reviews/issues/1069). Its verdict was "satisfied with this design" (Apr 2025). In that review Mozilla was supportive and WebKit had not stated a position. The [explainer](https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/AudioContextInterruptedState/explainer.md) came from Microsoft Edge.
- The working group expects the next revision of Web Audio to be finished in Q4 2026 ([Audio WG TPAC 2025 update](https://www.w3.org/2025/11/TPAC/demo-audio-wg-update.html)).

**`resume()` while interrupted.** If you call `resume()` on a context that is `"suspended"` while an interruption is active, the spec makes the state `"interrupted"`, fires `statechange`, and **rejects the promise with `InvalidStateError`** ([resume() algorithm](https://webaudio.github.io/web-audio-api/)). The explainer also says `resume()` rejects while the context is `"interrupted"` ([explainer](https://github.com/MicrosoftEdge/MSEdgeExplainers/blob/main/AudioContextInterruptedState/explainer.md)). Jer Noble (WebKit) said in #2392 that `resume()` would reject in that state and that resuming needs the user's permission, mediated by the UA ([#2392](https://github.com/WebAudio/web-audio-api/issues/2392)). Two other cases:

- If the context is not "allowed to start" (autoplay policy), `resume()` does **not** reject. Its promise waits in `[[pending resume promises]]` ([spec](https://webaudio.github.io/web-audio-api/)).
- If the document is not fully active (for example, it is in bfcache), `resume()` rejects with `InvalidStateError` ([spec](https://webaudio.github.io/web-audio-api/)).

**Browser support.**

- Safari: MDN's compatibility data lists `interrupted` in Safari 9+ (desktop and iOS) ([BCD](https://github.com/mdn/browser-compat-data/blob/main/api/BaseAudioContext.json)).
- Chrome/Edge: 136+ ([BCD](https://github.com/mdn/browser-compat-data/blob/main/api/BaseAudioContext.json)). Chromestatus says "Enabled by default" from M136 on desktop, Android and WebView ([chromestatus 5172068166139904](https://chromestatus.com/feature/5172068166139904)). It was implemented behind the `AudioContextInterruptedState` flag in Oct 2024 ([Chromium commit](https://chromium.googlesource.com/chromium/src/+/9d9ac4bd6a1880869b59c96a5408d36ba445a012), [crbug 374805121](https://issues.chromium.org/issues/374805121)).
  - _Uncertainty:_ the Nov 2025 TPAC update still calls Chromium's implementation an "Origin Trial" ([TPAC](https://www.w3.org/2025/11/TPAC/demo-audio-wg-update.html)). I also found no documentation of _which events_ make Chrome interrupt a context. Treat Chrome interruptions as possible but rare.
- Firefox: not supported ([BCD](https://github.com/mdn/browser-compat-data/blob/main/api/BaseAudioContext.json)).
- TypeScript's `lib.dom.d.ts` lacked `"interrupted"` as of [TypeScript#61823](https://github.com/microsoft/TypeScript/issues/61823), so compare against it as a string.

**When Safari/iOS interrupts.**

- MDN: on iOS Safari, "when a user leaves the page (e.g., switches tabs, minimizes the browser, or turns off the screen) the audio context's state changes to 'interrupted' and needs to be resumed" ([MDN state](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state)).
- Phone calls and screen lock are the motivating cases in the spec and explainer ([§2.7](https://webaudio.github.io/web-audio-api/), [TypeScript#61823](https://github.com/microsoft/TypeScript/issues/61823)).
- Reported in #2392: on iOS 16.6 the state became `"interrupted"` when the screen turned off. With `navigator.audioSession.type` set to `'auto'` or `'playback'` the context **resumed automatically** when the screen came back on. With `'transient'` it ended up `"suspended"`. A 2021 note says Safari interrupts _silent_ contexts on tab switch. Behaviour differs between macOS and iOS ([#2392](https://github.com/WebAudio/web-audio-api/issues/2392)).
- Siri and audio from other apps are not documented in a primary source I could find. They are _likely_ the same OS-level interruption as a phone call (unverified).
- WebKit bugs: [261554](https://bugs.webkit.org/show_bug.cgi?id=261554) ("AudioContext is getting suspended when page goes in the background" even with `playback`; fixed 275558@main, Mar 2024; a reporter says iOS 17.5 fixed it) and [270352](https://bugs.webkit.org/show_bug.cgi?id=270352) (resuming after a tab switch did not work; fixed 278859@main, May 2024). Both show that iOS 17.x builds varied in this area.
- **Audio Session API:** `navigator.audioSession.type` takes `playback`, `transient`, `transient-solo`, `ambient` or `play-and-record` ([W3C WD](https://www.w3.org/TR/2024/WD-audio-session-20241113), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Audio_Session_API)). Support: Safari 16.4+, no Chrome, Firefox "preview" only ([BCD](https://github.com/mdn/browser-compat-data/blob/main/api/AudioSession.json)). For a music-type app, `'playback'` is the type tied to background and screen-lock continuation.

### 6.2 Chrome: freezing, throttling, discarding

- **Page Lifecycle.**
  - `freeze` and `resume` fire on `document` (Chrome 68+). When frozen, timers and fetch callbacks don't run.
  - `document.wasDiscarded` is true after a discarded tab reloads.
  - `pagehide`/`pageshow` with `persisted === true` mean the page is entering or leaving bfcache.
  - `visibilitychange` covers tab switches, minimising and app switches on mobile.
  - A music app is "the most obvious example" of a page that shouldn't be frozen. Pages playing audio "won't be discarded unless under extreme resource constraints" ([Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)).
- **Workers and worklets freeze with the page.** The Page Lifecycle spec says: "Any dedicated worker agent whose … owning document is non-null and frozen must become blocked", and the same for worklet agents ([spec §5.1](https://wicg.github.io/page-lifecycle/spec.html)). That covers AudioWorklet in principle. _Uncertain:_ how Blink applies this to an AudioWorklet on the real-time audio thread. A page that is audibly playing should not be frozen in the first place.
- **Energy Saver freezing (Chrome 133+).** A tab group is frozen only if all its pages have been "hidden and silent for more than five minutes" and it is CPU-intensive. Conferencing, WebUSB/HID/Serial/Bluetooth, and Web Locks or IndexedDB connections exempt it ([blog](https://developer.chrome.com/blog/freezing-on-energy-saver)).
- **Timer throttling** ([Chrome 88 blog](https://developer.chrome.com/blog/timer-throttling-in-chrome-88), [MDN setTimeout](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)):
  - Hidden pages get 1 wake-up per second.
  - Intensive throttling (once per minute) applies when the page has been hidden more than 5 minutes, the timer chain count is 5 or more, the page has been silent at least 30 s, and WebRTC is not in use.
  - "A track that plays silence doesn't count" as sound. So a silent keep-alive oscillator does **not** exempt the page.
- **Memory Saver (Chrome 108+)** discards inactive tabs. No event fires; check `document.wasDiscarded` after reload ([blog](https://developer.chrome.com/blog/memory-and-energy-saver-mode)). The Chrome Help page lists "Active audio or video (playback or calls)" among activities that may prevent deactivation ([support](https://support.google.com/chrome/answer/12929150?hl=en)).
- **bfcache.** Chromium's list of bfcache blockers (`WebSchedulerTrackedFeature`) has **no** WebAudio entry. `kDedicatedWorkerOrWorklet` has been removed as a blocker. WebRTC, live MediaStreamTrack, BroadcastChannel and WebLocks are still listed ([mojom](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/public/mojom/scheduler/web_scheduler_tracked_feature.mojom)). So a page with an AudioContext can be bfcached in Chrome. WebKit fixed "AudioContext should not prevent entering the back/forward cache" in 2019 ([WebKit 203102](https://bugs.webkit.org/show_bug.cgi?id=203102)). _Uncertain:_ Firefox's behaviour, and what state the context is in after restore. Always re-check on `pageshow` with `persisted`. You can diagnose with `PerformanceNavigationTiming.notRestoredReasons` (Chrome 123+) ([docs](https://developer.chrome.com/docs/web-platform/bfcache-notrestoredreasons)).
- **Autoplay.** In Chrome, a context created before a user gesture starts `"suspended"`, and "you will need to call `resume()` after the user gesture" ([Chrome autoplay](https://developer.chrome.com/blog/autoplay)).
- **Device errors.** Chrome 128+ fires an `error` event on AudioContext for system audio resource errors and sets the state to `"suspended"` ([spec §2.8](https://webaudio.github.io/web-audio-api/), [BCD](https://github.com/mdn/browser-compat-data/blob/main/api/AudioContext.json)).

### 6.3 Firefox and Safari timers

- **Firefox desktop:** minimum timeout of 1 s in inactive tabs. Firefox for Android: 15 minutes, and it may unload the tab. Firefox "does not throttle inactive tabs if the tab contains an AudioContext" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)). Dedicated workers owned by a bfcached document are frozen ([Bugzilla 1178726](https://bugzilla.mozilla.org/show_bug.cgi?id=1178726)).
- **Safari:** WebKit added hidden-page DOM timer throttling, about 1 callback per second with aligned fire times, in 2012 ([WebKit 98474](https://www2.webkit.org/show_bug.cgi?id=98474)). _I found no current official documentation of Safari's rules_, so treat these numbers as historical.

### 6.4 Recovery best practices (derived from the sources above)

1. **Track the state from several events:** `ctx.onstatechange`, `document.visibilitychange`, `pageshow` (check `persisted`), `focus`, and Chrome's `resume`. Check `document.wasDiscarded` on load.
2. **When the page becomes visible again:**
   - If the state is `"running"`, do nothing. Safari may resume on its own ([#2392](https://github.com/WebAudio/web-audio-api/issues/2392)).
   - If it is `"suspended"` or `"interrupted"`, try `ctx.resume()`. Expect a rejection while `"interrupted"`, and a promise that may never settle without a user gesture ([spec](https://webaudio.github.io/web-audio-api/)).
   - Then show a "tap to resume sound" control and call `resume()` synchronously inside that `click`/`pointerup` handler ([Chrome autoplay](https://developer.chrome.com/blog/autoplay)).
3. **Health checks:** after `resume()` resolves, confirm `ctx.currentTime` is actually advancing, for example over 2 rAF frames. WebKit bug [270352](https://bugs.webkit.org/show_bug.cgi?id=270352) shows `resume()` "working" with no audio coming out.
4. **Rebuild when needed.** If the state is `"closed"`, the context is still stuck after a gesture, or `currentTime` is frozen: `close()` the old context, create a new `AudioContext`, re-run `audioWorklet.addModule()`, rebuild the graph, and restore your parameters from app state. Keep the graph construction in one idempotent function.
5. **AudioWorklet:** listen for `processorerror`. After an exception, the node "will output silence throughout its lifetime", so you have to create a new node ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode/processorerror_event)).
6. **Silent keep-alive tradeoff:** silence does **not** exempt a page from Chrome's intensive throttling ([Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)). Safari reportedly interrupts _silent_ contexts on tab switch ([#2392](https://github.com/WebAudio/web-audio-api/issues/2392)). A keep-alive mostly costs battery. It only helps in Firefox, where any AudioContext disables throttling ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout)).
7. **On Safari,** set `navigator.audioSession.type = 'playback'` when the feature exists ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type)).
8. **Don't drive audio timing from main-thread timers while hidden.** Schedule ahead on the audio clock or in the AudioWorklet, because timers drop to 1 Hz or 1/min.

## 7. Tools

### 7.1 Blender / bpy for low-poly anatomical models

- **Licence:** Blender source is GPL v2-or-later, and binaries are distributed under GPL v3. "What you create with Blender is your sole property", which covers images, .blend files and other data files. Python scripts that use the Blender API must be under a GPL-compatible licence _if published_ ([blender.org/about/license](https://www.blender.org/about/license/)). The GitHub API reports the licence as NOASSERTION ([repo](https://github.com/blender/blender)). So keep generator scripts separate from app code, or GPL them. The exported meshes are unencumbered.
- **bpy as a pip module:** "A pre-compiled bpy module is available via PIP". It behaves like `--background` mode, and starts with the default cube, camera and light in the scene ([docs](https://docs.blender.org/api/current/info_advanced_blender_as_bpy.html)). PyPI `bpy` is currently 5.2.2, GPL-3.0, and requires Python 3.13.\* ([PyPI](https://pypi.org/pypi/bpy/json)). Pin the Python version in CI.
- **glTF export:** the Khronos glTF-Blender-IO add-on (Apache-2.0) has been bundled since Blender 2.80 ([repo](https://github.com/KhronosGroup/glTF-Blender-IO)). Use `bpy.ops.export_scene.gltf(...)`, which supports Draco options (`export_draco_mesh_compression_enable`, `..._level`, `..._position_quantization`) ([API](https://docs.blender.org/api/current/bpy.ops.export_scene.html)). Blender also has STL import/export ([manual](https://docs.blender.org/manual/en/latest/files/import_export/stl.html)).

### 7.2 three.js (MIT)

- three.js is MIT, npm `three` 0.186.1 ([GitHub](https://github.com/mrdoob/three.js), [npm](https://registry.npmjs.org/three/latest)).
- Add-ons, all confirmed present on `dev`:
  - `examples/jsm/loaders/STLLoader.js`
  - `examples/jsm/objects/MarchingCubes.js`
  - `examples/jsm/exporters/STLExporter.js` and `GLTFExporter.js`
  - `examples/jsm/geometries/ConvexGeometry.js`

  ([repo tree](https://github.com/mrdoob/three.js/tree/dev/examples/jsm))

### 7.3 Meshing, SDF, voxelisation and STL libraries (licences verified via GitHub API and npm)

| Library                                                                                                                                   | Purpose                                                                                                                                                                                                                                                 | Licence              |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [mikolalysenko/isosurface](https://github.com/mikolalysenko/isosurface) (npm `isosurface` 1.0.0)                                          | `surfaceNets`, `marchingCubes`, marching tetrahedra from a potential function                                                                                                                                                                           | MIT (last push 2014) |
| [mikolalysenko/surface-nets](https://github.com/mikolalysenko/surface-nets) (npm 1.0.2)                                                   | Surface nets on ndarrays                                                                                                                                                                                                                                | MIT                  |
| [mikolalysenko/voxelize](https://github.com/mikolalysenko/voxelize) (npm 1.0.0)                                                           | Mesh to voxels                                                                                                                                                                                                                                          | MIT (2014)           |
| [gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) (npm 0.9.16)                                                      | BVH raycasting and closest-point queries; has `voxelize`, `sdfGeneration` and `webgpu_sdfGeneration` examples ([examples](https://github.com/gkjohnson/three-mesh-bvh/tree/master/example)). Good for point-in-mesh tests that classify FDTD grid cells | MIT                  |
| [elalish/manifold](https://github.com/elalish/manifold) (npm `manifold-3d` 3.5.4, WASM)                                                   | Guaranteed-manifold booleans, plus a level-set (SDF) mesher it says "improves significantly over Marching Cubes". The WASM build is serial-only                                                                                                         | Apache-2.0           |
| [fogleman/sdf](https://github.com/fogleman/sdf)                                                                                           | Python SDF modelling to mesh (offline asset generation)                                                                                                                                                                                                 | MIT                  |
| [parse-stl](https://registry.npmjs.org/parse-stl/latest) (npm 1.0.2), [stl-parser](https://registry.npmjs.org/stl-parser/latest) (0.12.0) | STL parsing                                                                                                                                                                                                                                             | MIT                  |

### 7.4 GPU FDTD in the browser

- **WebGPU support:**
  - Chrome/Edge 113+ on ChromeOS, macOS and Windows; Linux from 144 (Intel Gen12+ only); Android 121+.
  - Safari 26 (macOS, iOS, iPadOS, visionOS).
  - Firefox 141+ on Windows; macOS Tahoe on Apple silicon from 145; older macOS on Apple silicon from 147. No Linux, no Intel Mac, no Android, and no service workers.

  Sources: [MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/api/GPU.json), [web.dev, Nov 2025](https://web.dev/blog/webgpu-supported-major-browsers). You still need a WebGL2 or CPU fallback.

- **Published or open-source examples:**
  - Galera et al., "A WebGPU-based acoustic wave simulator for ultrasound NDT", _Research and Review Journal of NDT_ 1(1), 2023, DOI 10.58286/28120 ([DOAJ](https://doaj.org/article/11b3718a049049a8b4db9a5f6eea46a2), [LASSIP](https://utfpr.curitiba.br/lassip/?p=280)). This is the only peer-reviewed WebGPU acoustic solver I found. I could not check whether its code is public.
  - [RobinKa/maxwell-simulation](https://github.com/RobinKa/maxwell-simulation): MIT, about 140 stars, electromagnetic FDTD in WebGL shaders, demo at [cemsim.com](https://cemsim.com/).
  - [timdrysdale/webgl-fdtd](https://github.com/timdrysdale/webgl-fdtd): MIT, electromagnetic FDTD in WebGL.
  - Small WebGPU repos ([GitHub search](https://github.com/search?q=webgpu+fdtd&type=repositories)):
    - [LeeeeT/resona](https://github.com/LeeeeT/resona): 2D WebGPU FDTD plus ray-traced acoustics through Web Audio. **No licence file**, so reference only.
    - [vkopitsa/webantenna](https://github.com/vkopitsa/webantenna): MIT, WebGPU electromagnetic FDTD.
    - [Helron1977/Hypercube-gpu](https://github.com/Helron1977/Hypercube-gpu): MIT, WebGPU compute core.
    - [oneirocosm/webgpu-wave-eqn](https://github.com/oneirocosm/webgpu-wave-eqn): MIT, 2D wave equation.
  - [bsxfun/pffdtd](https://github.com/bsxfun/pffdtd) (Brian Hamilton): MIT, a 3D room-acoustics FDTD in Python/C/CUDA. It is offline, but it is a good reference for the scheme and boundary handling to port to WGSL.
  - Native GPU acoustic FDTD papers: CUDA/OpenGL room acoustics ([Hamilton et al. 2013, FCC scheme](https://www.ness.music.ed.ac.uk/wp-content/uploads/2013/06/hamilton2013fccGPU.pdf), [Mehra et al., UNC](https://gamma.cs.unc.edu/GPUSOUND)).
- **Gaps:** I found no peer-reviewed WebGPU _room_ acoustics FDTD (none came up searching "webgpu room acoustics"). The WebGPU repos above are young and low-star, so check their quality before adopting.
