# Roadmap

This is the step-by-step plan that takes voice-simulator from what it is today
to the [vision](VISION.md): a physical model of the human voice that speaks and
listens, without neural networks, in the public domain.

Every step is a GitHub issue. Every issue is marked as a **Bug** or a
**Feature**, belongs to one milestone, and names the issues that block it. The
issues were planned in
[issue 11](https://github.com/konard/voice-simulator/issues/11); the analysis
behind them is the
[issue 11 case study](case-studies/issue-11/README.md).

## How to use the roadmap

1. Pick an open issue from the tables below whose "Blocked by" issues are all
   closed. Inside a milestone, take bugs before features.
2. Read the issue from top to bottom. Each one has the same sections: Goal,
   Why, Current state, What to do, Tests, Acceptance criteria, Out of scope and
   References. The issue names the files, the functions and the numbers, so no
   other document is needed to start.
3. Follow the [rules](#rules-for-every-roadmap-issue). Deliver one pull request
   per issue.
4. The issue is done when every box under "Acceptance criteria" is ticked and
   the checks pass. If a number in an acceptance criterion cannot be reached,
   do not lower it silently: report the measured value in the pull request and
   ask in the issue.

GitHub shows the same dependencies in the "Blocked by" and "Blocking" fields of
every issue, and the milestones show the progress of each stage.

## Stages

The milestones are stages of one plan. Later stages depend on earlier ones only
through the blockers listed per issue, so several stages can move at once.

| Stage                                         | What it delivers                                                                                                                                                          | Why it is at this place                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Foundations and measurement                | The manually triggered workflow for expensive checks, the policy check (no neural networks, permissive licences), public recordings, metrics and the first quality report | Nothing can be called better before it is measured, and the rules of the vision have to be enforced by a machine                                   |
| 1. Rust engine and adaptive quality           | The Rust core as WebAssembly in a background worker as the default engine, multicore with a single-core fallback, narrow-band tiers, quality that follows the device      | Performance is what keeps most devices away from the accurate tiers today                                                                          |
| 2. Voice physics and configuration            | Simulated vocal folds, source-tract coupling, physical noise, losses, articulator dynamics, durations and many more voice parameters                                      | Listening studies place the remaining gap to natural speech in the source, the noise and the movements, not in the detail of the tract (see below) |
| 3. Languages and modes of speech              | Fixes of wrong tones, stress and readings; lexicons; tone and intonation models; markup; loudness, whisper, voice qualities, emotions, accents                            | Every mode has to be spoken before it can be recognised                                                                                            |
| 4. Reverse simulation (listening)             | Audio → IPA → language → text by inverting the simulator, with syllable highlighting, in the library, the command line, the server and the app                            | Needs the metrics and recordings of stage 0, and the voice parameters of stage 2 to fit a speaker                                                  |
| 5. Voice copy and state-of-the-art validation | The multi-pass session that copies a voice while it recognises it, certification at the lowest settings, and the public evaluation against real speech                    | The last stage: it joins both directions and reports honestly where the system stands                                                              |

### What decides the order of quality work

Listening studies with a physical synthesiser decide it. Birkholz and Drechsel
(2021) added three anatomical details to the tract (piriform fossae, coupling
through the velum, sound radiated by the neck); listeners did not rate the
result as more natural, and the authors conclude that the voice source matters
more. Blandin, Didone and Birkholz (2024) compared 1D and 3D acoustics for seven
sounds and found no significant effect on rated naturalness. An earlier study
of the same group (Blandin and others 2023) did find that listeners prefer 3D
for the vowels /o/ and /u/, so 3D stays the reference tier, but it is not
where most of the gap to natural speech is.

The roadmap therefore improves, in this order: the vocal folds and their
coupling to the tract, turbulence and plosive bursts, articulator dynamics and
durations, then the losses in the 1D solver, and only then finer grids. Details
and sources are in
[the performance and physics research](case-studies/issue-11/research/5-performance-and-physics.md).

<!-- roadmap:begin -->

The tables are generated after the issues are created.

<!-- roadmap:end -->

## Rules for every roadmap issue

The same rules are printed at the end of every issue.

- Read [VISION.md](VISION.md), this file and [CONTRIBUTING.md](CONTRIBUTING.md)
  first.
- **No neural networks** in the library, the app, the tests or the tools, and
  no playback of recorded speech. Allowed: physics, closed-form signal
  processing, search, optimisation, dynamic programming and small documented
  tables.
- **Public domain.** New code is Unlicense. New dependencies need a permissive
  licence (MIT, BSD, Apache-2.0, ISC, Zlib, CC0, Unlicense). Committed data is
  public domain or CC0; anything else is downloaded at test time and never
  committed.
- One pull request per issue. Do not start before every issue under "Blocked
  by" is closed.
- Work in the JavaScript reference implementation in `src/` unless the issue
  says otherwise. If the directory `crates/` exists when you start, implement
  the same numerical code in the Rust core too and extend the parity tests.
- Same input, seed and options must give the same samples on Node.js, Bun and
  Deno. Take randomness only from `src/random.js`.
- Add tests in `tests/` that fail before the change and pass after it. Tests
  that need more than about 10 seconds or a download run only in the manually
  triggered workflow.
- Keep every source and Markdown file under 1500 lines, run `npm run check` and
  `npm test`, and add a changeset (`npm run changeset`) when code changes.
- Update `README.md`, `src/index.d.ts`, the command line help and this file
  when behaviour or the public API changes. Put experiment scripts in
  `experiments/` and name them after the issue's number.
- Report measured numbers with the command that produced them. Do not write a
  claim that was not measured.

## How the roadmap is maintained

- The text of every issue is kept in
  [case-studies/issue-11/plan](case-studies/issue-11/plan/README.md), one file
  per issue, with the names that the issues share (files, functions, formats).
- `node experiments/issue-11-create-issues.mjs check` validates the plan: every
  issue has all sections, every blocker exists and the dependencies have no
  cycle. `create` made the GitHub issues, milestones and "blocked by" links;
  `roadmap` writes the tables and the graph above from
  [the list of created issues](case-studies/issue-11/data/created-issues.json).
- A pull request that finishes an issue ticks nothing here: the state of an
  issue lives on GitHub. A pull request that changes the direction updates
  [VISION.md](VISION.md) and adds or edits issues, then this file.
