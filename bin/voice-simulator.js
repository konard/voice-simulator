#!/usr/bin/env node

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  addLexicon,
  AUDIO_FORMAT_NAMES,
  AUDIO_TIERS,
  DEFAULT_AUDIO_TIER,
  audioEncoding,
  ROOM_PRESETS,
  benchmarkAudioTiers,
  benchmarkDevice,
  compareRecordings,
  createEngine,
  ENGINE_NAMES,
  decodeAudio,
  DEFAULT_HEAD,
  decodeHeadConfig,
  encodeHeadConfig,
  formatFromFileName,
  headModelObj,
  loadAccent,
  loadVoice,
  matchVoice,
  measureAudioTier,
  prepareUtterance,
  presetHeadConfig,
  randomHeadConfig,
  resample,
  saveVoice,
  synthesize,
  textToIpa,
  ipaToText,
  identifyLanguage,
  visemeTrack,
  VISEME_FORMATS,
} from '../src/index.js';
import { INDEX_PAGE, createVoiceServer } from '../src/server/server.js';

const OPTIONS = {
  boundaries: { type: 'string' },
  beam: { type: 'string' },
  nbest: { type: 'string' },
  languages: { type: 'string' },
  'switch-penalty': { type: 'string' },
  'min-sounds': { type: 'string' },
  lang: { type: 'string', short: 'l' },
  accent: { type: 'string' },
  'accent-level': { type: 'string' },
  lexicon: { type: 'string', multiple: true },
  out: { type: 'string', short: 'o' },
  tier: { type: 'string', short: 't' },
  solver: { type: 'string' },
  source: { type: 'string' },
  interaction: { type: 'boolean' },
  dx: { type: 'string' },
  seed: { type: 'string', short: 's' },
  head: { type: 'string' },
  voice: { type: 'string' },
  'voice-file': { type: 'boolean' },
  full: { type: 'boolean' },
  preset: { type: 'string' },
  output: { type: 'string' },
  'sample-rate': { type: 'string' },
  format: { type: 'string', short: 'f' },
  'bit-depth': { type: 'string', short: 'b' },
  float: { type: 'boolean' },
  'mic-distance': { type: 'string' },
  'mic-azimuth': { type: 'string' },
  'mic-elevation': { type: 'string' },
  'mic-compensate': { type: 'boolean' },
  room: { type: 'string' },
  rt60: { type: 'string' },
  box: { type: 'string' },
  'box-absorption': { type: 'string' },
  ipa: { type: 'boolean' },
  markup: { type: 'boolean' },
  breaths: { type: 'boolean' },
  plain: { type: 'boolean' },
  loudness: { type: 'string' },
  headroom: { type: 'string' },
  'strong-forms': { type: 'boolean' },
  lod: { type: 'string' },
  seconds: { type: 'string' },
  repeats: { type: 'string' },
  quick: { type: 'boolean' },
  port: { type: 'string', short: 'p' },
  host: { type: 'string' },
  transcript: { type: 'string' },
  iterations: { type: 'string' },
  fps: { type: 'string' },
  json: { type: 'boolean' },
  engine: { type: 'string' },
  threads: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function usage() {
  return [
    'Usage: voice-simulator <command> [options]',
    '',
    'Commands:',
    '  ipa <text>          Print the IPA transcription (en, ru, hi, zh)',
    '                      (Russian: + before a vowel or U+0301 after it sets',
    '                      the stress, з+амок; ё is restored from е)',
    '  text <ipa>          Decode IPA into words (--lang en, ru, hi, zh)',
    '                      --boundaries given|search --beam 32 --nbest 1 --json',
    '  language <ipa>      Identify languages and print language, sound range, confidence',
    '                      --languages en,ru,hi,zh --switch-penalty 6 --min-sounds 8 --json',
    '  say <text> -o f.wav Simulate speech and write an audio file',
    '  convert <in> -o out Convert an audio file (WAV, FLAC, AIFF, AU) to mono',
    '  timeline <text>     Print when each word and syllable is spoken',
    '  visemes <text>      Face animation as JSON (ARKit, VRM or Oculus)',
    '  head                Print a random head configuration (or the head',
    '                      of --head or --voice); --voice-file prints it as',
    '                      a voice file, --full with every value',
    '  voice check <file>  Check a voice file (exit code 1 on a problem)',
    '  mesh -o head.obj    Export the low-poly head model as OBJ',
    '  match <file>        Find the head that sounds like a recording',
    '  compare <ref> <test>',
    '                      Distances of a recording from a reference',
    '                      (LSD, MCD, f0, formants, timing)',
    '  benchmark           Measure the audio LOD tiers on this machine',
    '  serve               Start the HTTP API (with streaming)',
    '',
    'Library source analysis: inverseFilter(analyzeFrames(samples, rate))',
    '  Batch flow, closure times and voice-source measures; docs/INVERSE-FILTER.md',
    'Library: buildCodebook / frameEnvelope provide articulatory candidates',
    '         (generated on first use; API and limits: docs/CODEBOOK.md)',
    '',
    'Options:',
    '  -l, --lang <code>     auto | en | ru | hi | zh (default auto)',
    '      --accent <code|file.json>',
    '                        Accent of the language (docs/accents.md): en-US |',
    '                        en-GB | en-AU | en-IN | en-CA | ru-x-north |',
    '                        ru-x-south | hi-x-east | zh-TW | zh-x-south, or',
    '                        foreign: <lang>-x-<first language>, e.g. en-x-ru,',
    '                        zh-x-en; or an accent file (JSON)',
    '      --accent-level <0..1>',
    '                        Strength of the accent (default 1; 0 = none)',
    '      --strong-forms    Keep English function words strong (no weak forms)',
    '      --lexicon <file>  Pronunciation lexicon (JSON): {"word": "ipa"} for',
    '                        --lang, or a file of build-lexicon.mjs (--full',
    '                        or vslex); zh takes toned pinyin. Repeat',
    '                        it for more files; the last one wins',
    '      --markup          Read inline tags: [whisper]…[/whisper], [pause 0.5],',
    '                        [laugh], *word*, [tune IK4]…[/tune], [breathy],',
    '                        [creaky], [pressed], [lax], [falsetto], [harsh],',
    '                        emotions [angry], [happy 0.5], [sad], [afraid],',
    '                        [bored], [surprised], [disgusted], [tender],',
    '                        [sarcastic], [confident], [hesitant]',
    '                        (docs/markup.md); SSML (<speak>…) is read without',
    '                        it. A whisper has no voicing, is 25 dB quieter',
    '                        and 1.3x as long. Sounds: [inhale], [exhale],',
    '                        [sigh], [laugh], [laugh 1.2], [filler], [um],',
    '                        [cough], [throat], [click]; written um, uh,',
    '                        hahaha are read as sounds without --markup',
    '      --breaths         Breathe in between sentences: an inhale in each',
    '                        pause of 0.3 s or more after . ? ! (docs/markup.md)',
    '      --plain           Read the text as it is, without any markup',
    '      --loudness <LUFS> Scale the audio to this integrated loudness',
    '                        (ITU-R BS.1770), e.g. --loudness=-23; the peak',
    '                        stays at or below 0.98',
    '      --headroom <dB>   Lower the output by this much (default: the',
    '                        largest effort and gain of the markup, so a',
    '                        [shout] does not clip; docs/markup.md)',
    '  -o, --out <file>      Output file ("-" for stdout)',
    `  -t, --tier <name>     ${AUDIO_TIERS.map((tier) => tier.name).join(' | ')}`,
    `                        (default ${DEFAULT_AUDIO_TIER}: 3D; medium: real-time waveguide)`,
    `                        ${AUDIO_TIERS.filter((tier) => tier.bandLimit)
      .map((tier) => `${tier.name} ${tier.sampleRate / 1000}`)
      .join(', ')} kHz: band-limited`,
    '      --solver <name>   waveguide | fdtd2d | fdtd3d (overrides the tier)',
    '      --source <name>   lf | folds: voice source (default lf; folds =',
    '                        vocal folds driven by the lung pressure)',
    '      --interaction     Couple the folds to the vocal tract and the',
    '                        trachea (source-tract interaction; needs',
    '                        --source folds and a CPU solver)',
    '      --dx <cm>         FDTD cell (2D) or voxel (3D) size',
    '  -s, --seed <seed>     Random seed for the head and the voice',
    '      --head <value>    "random" or an encoded head (key=value&...),',
    '                        e.g. lungPressure=1600 (Pa, default 800): louder',
    '                        breath, frication and bursts; or',
    '                        wallMass=2.5&wallResistance=1200 (tract walls);',
    '                        coarticulation=1.5 (articulators move earlier);',
    '                        speechRate=1.5 (faster; phrase pauses shrink most);',
    '                        larynxPosture=-0.5&lipPosture=0.3 (lower larynx,',
    '                        pushed-out lips); jawPosture, tongueRootPosture,',
    '                        intrinsicPitch=1.5, larynxPitch=0.3;',
    '                        finalCreak=1 (creaky end of a statement)',
    '      --voice <file>    Voice file (JSON, docs/VOICE-PARAMETERS.md); --head',
    '                        wins over --voice, which wins over --preset',
    '      --preset <name>   any | male | female | child | child5 | teenMale |',
    '                        teenFemale | elderlyMale | elderlyFemale | bass |',
    '                        baritone | tenor | alto | mezzo | soprano',
    '      --output <mode>   flow | microphone (FDTD only)',
    '      --sample-rate <n> Output sample rate',
    `  -f, --format <name>   ${AUDIO_FORMAT_NAMES.join(' | ')} (default: from -o, else wav)`,
    '  -b, --bit-depth <n>   8 | 16 | 24 | 32 (default 16; 32 | 64 with --float)',
    '      --float           IEEE float samples (wav, aiff, au, raw)',
    '      --mic-distance <cm>     Microphone distance from the lips (default 3)',
    '      --mic-azimuth <deg>     0 = ahead, 90 = left, 180 = behind the head',
    '      --mic-elevation <deg>   Positive = above the mouth',
    '      --mic-compensate        Keep the loudness of a 3 cm microphone',
    '      --room <name|WxHxD>     Room preset or size in metres (e.g. 5x3x4):',
    `                              ${Object.keys(ROOM_PRESETS).join(', ')}`,
    '      --rt60 <s>              Reverberation time of the room',
    '      --box <WxHxD>           Box of air around the head in cm (fdtd3d)',
    '      --box-absorption <0-1>  Wall absorption of the box (default 0.2)',
    '      --ipa             Treat <text> as IPA',
    '      --transcript <t>  What the recording says (closer match)',
    '      --iterations <n>  Renders while matching (default 4, max 12)',
    '      --seconds <s>     Audio per benchmark measurement (default 0.3)',
    '      --repeats <n>     Benchmark measurements per tier, median (default 5)',
    '      --quick           Benchmark like the app on load: about 1 s of CPU',
    '                        in 20 ms slices, then print the CPU time',
    '      --lod <0-3>      Mesh level of detail',
    `      --fps <n>         Visemes per second (default 60); visemes take
                        -f ${Object.keys(VISEME_FORMATS).join(' | ')} (default arkit)`,
    '  -p, --port <port>     Server port (default 8080, env PORT)',
    '      --host <host>     Server host (default 127.0.0.1, env HOST)',
    '      --engine <name>   auto | rust | js: the engine that renders',
    '                        (default auto: Rust when voice-simulator.wasm',
    '                        loads, else JavaScript; js is byte-stable)',
    '      --threads <n|auto> Threads of the Rust engine (default 1)',
    '      --json            Machine-readable output',
    '  -h, --help            Show this help',
    '  -v, --version         Show package version',
  ].join('\n');
}

/**
 * The options of createEngine from --engine and --threads.
 * @param {Record<string, string|boolean|undefined>} values Parsed flags.
 * @returns {{engine: 'auto'|'rust'|'js', threads?: number|'auto'}}
 */
export function engineFlags(values) {
  const engine = values.engine ?? 'auto';
  if (!ENGINE_NAMES.includes(engine)) {
    throw new Error(`Unknown engine: ${engine} (${ENGINE_NAMES.join(', ')})`);
  }
  const { threads } = values;
  if (threads === undefined || threads === 'auto') {
    return { engine, threads };
  }
  const count = Number(threads);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`threads must be a positive integer or auto: ${threads}`);
  }
  return { engine, threads: count };
}

function readVersion() {
  const packageUrl = new URL('../package.json', import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageUrl, 'utf8'));
  return packageJson.version;
}

function optionalNumber(value, label) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number`);
  }
  return parsed;
}

/** Reads a voice file strictly; the error names the file. */
function readVoiceFile(file) {
  try {
    return loadVoice(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

/** Reads an accent file; the error names the file. */
function readAccentFile(file) {
  try {
    return loadAccent(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

/**
 * The accent options of --accent (a code or a JSON file), --accent-level
 * and the accent of the --voice file (which --accent wins over).
 */
function accentOptions(values) {
  const level = optionalNumber(values['accent-level'], 'accent-level');
  if (level !== undefined && (level < 0 || level > 1)) {
    throw new Error('accent-level must be a number from 0 to 1');
  }
  let accent = values.accent;
  if (accent !== undefined && /\.json$/iu.test(accent)) {
    accent = readAccentFile(accent);
  } else if (accent === undefined && values.voice !== undefined) {
    accent = readVoiceFile(values.voice).accent ?? undefined;
  }
  return { accent, accentLevel: level };
}

/** The head of --head, else --voice, else --seed and --preset. */
function resolveHead(values) {
  if (values.head && values.head !== 'random') {
    return decodeHeadConfig(values.head);
  }
  if (values.voice !== undefined && values.head !== 'random') {
    return readVoiceFile(values.voice).head;
  }
  if (
    values.head === 'random' ||
    values.seed !== undefined ||
    values.preset !== undefined
  ) {
    return randomHeadConfig(values.seed ?? Date.now(), {
      preset: values.preset,
    });
  }
  return undefined;
}

/**
 * `head --voice-file`: saveVoice of the head of --head, --voice or
 * --seed and --preset; without them the mid-size head of --preset (or the
 * defaults), so `head --preset bass --voice-file` is the bass itself.
 */
function headVoiceFile(values) {
  const options = { full: values.full };
  if (values.head !== undefined || values.seed !== undefined) {
    return saveVoice(
      { preset: values.preset, head: resolveHead(values) },
      options
    );
  }
  if (values.voice !== undefined) {
    return saveVoice(readVoiceFile(values.voice), options);
  }
  const named = values.preset && values.preset !== 'any';
  const head = named ? presetHeadConfig(values.preset) : DEFAULT_HEAD;
  return saveVoice({ preset: values.preset, head }, options);
}

function boxSize(value, label) {
  const parts = value.split(/[x×*]/i).map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite)) {
    throw new Error(`${label} must look like WxHxD, e.g. 5x3x4`);
  }
  return { width: parts[0], height: parts[1], depth: parts[2] };
}

function resolveRoomFlag(values) {
  const rt60 = optionalNumber(values.rt60, 'rt60');
  if (values.room === undefined && rt60 === undefined) {
    return undefined;
  }
  const name = values.room ?? 'small-room';
  if (/^[\d.]/.test(name)) {
    return { ...boxSize(name, 'room'), rt60 };
  }
  if (rt60 === undefined || name === 'anechoic') {
    return name;
  }
  if (!Object.hasOwn(ROOM_PRESETS, name)) {
    throw new Error(`Unknown room: ${name}`);
  }
  return { ...ROOM_PRESETS[name], rt60 };
}

/**
 * Microphone, room and enclosure options from the command-line flags.
 * @param {Record<string, string|boolean|undefined>} values Parsed flags.
 * @returns {{microphone?: object, room?: string|object, enclosure?: object}}
 */
export function listeningOptions(values) {
  const result = {};
  const microphone = {
    distance: optionalNumber(values['mic-distance'], 'mic-distance'),
    azimuth: optionalNumber(values['mic-azimuth'], 'mic-azimuth'),
    elevation: optionalNumber(values['mic-elevation'], 'mic-elevation'),
    compensate: values['mic-compensate'],
  };
  if (Object.values(microphone).some((value) => value !== undefined)) {
    result.microphone = microphone;
  }
  const room = resolveRoomFlag(values);
  if (room !== undefined) {
    result.room = room;
  }
  const absorption = optionalNumber(values['box-absorption'], 'box-absorption');
  if (values.box !== undefined) {
    result.enclosure = { ...boxSize(values.box, 'box'), absorption };
  } else if (absorption !== undefined) {
    throw new Error('box-absorption needs --box');
  }
  return result;
}

/**
 * The `markup` option of --markup and --plain: true, false or undefined
 * (SSML only, when the text starts with `<speak`).
 */
function markupOption(values) {
  if (values.markup && values.plain) {
    throw new Error('--markup and --plain cannot be used together');
  }
  if (values.plain) {
    return false;
  }
  return values.markup ? true : undefined;
}

/** Print the markup warnings on stderr. */
function reportWarnings(result, io) {
  for (const warning of result.warnings ?? []) {
    io.stderr(`markup: ${warning.message} at ${warning.position}`);
  }
}

function requireText(positionals) {
  const text = positionals.join(' ').trim();
  if (!text) {
    throw new Error('Missing <text>');
  }
  return text;
}

function writeOutput(out, data, io) {
  if (out === '-') {
    io.stdoutBytes(data);
    return;
  }
  writeFileSync(out, data);
}

/**
 * Output file and encoding: --format wins, then the --out extension, then
 * WAV; the default file name follows the format.
 */
function audioOutput(values, baseName) {
  const out = values.out;
  const named = out && out !== '-' && extname(out) ? out : null;
  const inferred = named ? formatFromFileName(named) : null;
  if (named && !inferred && !values.format) {
    throw new Error(
      `Unknown audio extension "${extname(named)}" (use --format ${AUDIO_FORMAT_NAMES.join('|')})`
    );
  }
  const encoding = audioEncoding({
    format: values.format ?? inferred ?? 'wav',
    bitDepth: values['bit-depth'],
    float: values.float,
  });
  return {
    out: out ?? `${baseName}.${encoding.format.extension}`,
    encode: (samples, sampleRate) =>
      encoding.format.encode(samples, sampleRate, {
        bitDepth: encoding.bitDepth,
        float: encoding.float,
      }),
  };
}

function fixed(value, digits, unit = '') {
  return value === null || value === undefined
    ? 'n/a'
    : `${value.toFixed(digits)}${unit}`;
}

/**
 * One line per metric of a `compareRecordings` result.
 * @param {object} result
 * @returns {string[]}
 */
export function formatComparison(result) {
  const { f0, formants, timing, duration } = result;
  const lines = [
    `LSD ${fixed(result.lsd, 2, ' dB')}`,
    `MCD ${fixed(result.mcd, 2, ' dB')}`,
    `F0 RMSE ${fixed(f0.rmseCents, 1, ' cents')}, mean ${fixed(f0.meanCents, 1, ' cents')}, ` +
      `correlation ${fixed(f0.correlation, 3)}`,
    `GPE ${fixed(f0.gpe === null ? null : 100 * f0.gpe, 1, ' %')}, ` +
      `VDE ${fixed(f0.vde === null ? null : 100 * f0.vde, 1, ' %')}, ` +
      `FFE ${fixed(f0.ffe === null ? null : 100 * f0.ffe, 1, ' %')} ` +
      `(${f0.voicedFrames} of ${f0.frames} frames voiced in both)`,
  ];
  if (formants) {
    const names = ['f1', 'f2', 'f3'];
    lines.push(
      `Formants ${names
        .map(
          (name, index) =>
            `F${index + 1} ${fixed(formants[name].hz, 0, ' Hz')} (${fixed(formants[name].percent, 1, ' %')})`
        )
        .join(', ')} over ${formants.frames} frames`
    );
  }
  lines.push(
    `Timing RMS ${fixed(timing.rmsSeconds, 3, ' s')}, max ${fixed(timing.maxSeconds, 3, ' s')}`,
    `Duration ${fixed(duration.reference, 2, ' s')} -> ${fixed(duration.test, 2, ' s')} (ratio ${fixed(duration.ratio, 3)})`,
    `DTW cost ${fixed(result.dtw.normalizedCost, 3)} per step at ${result.sampleRate} Hz`
  );
  return lines;
}

/**
 * Add the lexicons of `--lexicon` (JSON files) with `addLexicon`. A file
 * with a `format` (`lexicon` or `vslex`) is for its `lang`; a plain
 * `{word: ipa}` file is for `--lang`.
 * @returns {number} the number of words added
 */
export function loadLexiconFiles(files, lang) {
  let words = 0;
  for (const file of files ?? []) {
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`--lexicon ${file}: ${error.message}`, { cause: error });
    }
    const target = typeof data?.format === 'string' ? data.lang : lang;
    if (!target || target === 'auto') {
      throw new Error(
        `--lexicon ${file}: the file has no "lang"; give --lang en, ru, hi or zh`
      );
    }
    try {
      words += addLexicon(target, data);
    } catch (error) {
      throw new Error(`--lexicon ${file}: ${error.message}`, { cause: error });
    }
  }
  return words;
}

/**
 * The lines of `timeline` without --json: a word per line, and a sound
 * that is not a written word (`[laugh]`, a breath) as `⸨name⸩`, by start.
 */
function timelineLines(timeline) {
  const lines = timeline.words.map((word) => {
    const syllables = word.syllables
      .map((syllable) => syllable.text ?? syllable.spoken ?? syllable.ipa)
      .join('·');
    const said = word.spoken ? ` (${word.spoken})` : '';
    return {
      start: word.start,
      text: `${word.start.toFixed(3)} ${word.end.toFixed(3)} ${word.text}${said} /${word.syllables.map((syllable) => syllable.ipa).join('.')}/ ${syllables}`,
    };
  });
  for (const sound of timeline.sounds ?? []) {
    const written = timeline.words.some(
      (word) => word.sound && word.start <= sound.end && sound.start <= word.end
    );
    if (!written) {
      lines.push({
        start: sound.start,
        text: `${sound.start.toFixed(3)} ${sound.end.toFixed(3)} ⸨${sound.name}⸩`,
      });
    }
  }
  return lines
    .sort((left, right) => left.start - right.start)
    .map((line) => line.text);
}

/** The lines of `benchmark`: the engine, the load of each tier, the choice. */
function printTierLoads(result, io, engine) {
  io.stdout(`engine: ${engine.name}`);
  result.loads.forEach((load, index) => {
    const note = result.measured[index] ? '' : ' (predicted, not run)';
    io.stdout(`${AUDIO_TIERS[index].name}: load ${load.toFixed(3)}${note}`);
  });
  io.stdout(`selected: ${result.tier.name}`);
}

/**
 * `benchmark --quick`: the silent load-time benchmark of the app
 * (benchmarkDevice, issue 28) and the CPU time it took.
 */
async function quickBenchmark(values, io, engine) {
  const result = await benchmarkDevice({ engine });
  if (values.json) {
    io.stdout(JSON.stringify(result));
    return;
  }
  printTierLoads(result, io, engine);
  io.stdout(`cpu: ${result.cpuSeconds.toFixed(2)} s`);
}

const COMMANDS = {
  language(values, positionals, io) {
    const result = identifyLanguage(requireText(positionals), {
      languages: values.languages?.split(','),
      switchPenalty: optionalNumber(values['switch-penalty'], 'switch-penalty'),
      minSounds: optionalNumber(values['min-sounds'], 'min-sounds'),
    });
    if (values.json) {
      io.stdout(JSON.stringify(result));
    } else {
      for (const span of result.spans) {
        io.stdout(
          `${span.language} ${span.from}-${span.to} ${span.confidence.toFixed(2)}`
        );
      }
    }
  },
  text(values, positionals, io) {
    const result = ipaToText(requireText(positionals), {
      language: values.lang,
      boundaries: values.boundaries,
      beam: optionalNumber(values.beam, 'beam'),
      nbest: optionalNumber(values.nbest, 'nbest'),
    });
    io.stdout(values.json ? JSON.stringify(result) : result.text);
  },
  ipa(values, positionals, io) {
    const result = textToIpa(requireText(positionals), {
      lang: values.lang,
      ...accentOptions(values),
      weakForms: values['strong-forms'] ? false : undefined,
      markup: markupOption(values),
    });
    reportWarnings(result, io);
    io.stdout(values.json ? JSON.stringify(result) : result.ipa);
  },

  say(values, positionals, io, engine) {
    const output = audioOutput(values, 'voice');
    const result = synthesize(requireText(positionals), {
      engine,
      lang: values.lang,
      ...accentOptions(values),
      weakForms: values['strong-forms'] ? false : undefined,
      ipa: values.ipa,
      markup: markupOption(values),
      breaths: values.breaths || undefined,
      seed: values.seed,
      head: resolveHead(values),
      tier: values.tier,
      solver: values.solver,
      source: values.source,
      interaction: values.interaction || undefined,
      dx: optionalNumber(values.dx, 'dx'),
      output: values.output,
      sampleRate: optionalNumber(values['sample-rate'], 'sample-rate'),
      headroom: optionalNumber(values.headroom, 'headroom'),
      loudnessTarget: optionalNumber(values.loudness, 'loudness'),
      ...listeningOptions(values),
    });
    reportWarnings(result, io);
    const { out } = output;
    writeOutput(out, output.encode(result.samples, result.sampleRate), io);
    if (out !== '-' && values.json) {
      io.stdout(
        JSON.stringify({
          lang: result.lang,
          accent: result.accent,
          accentLevel: result.accentLevel,
          ipa: result.ipa,
          duration: result.duration,
          out,
          levelOffsetDb: result.levelOffsetDb,
          loudness: result.loudness,
          modes: result.plan.modes,
          sounds: result.plan.sounds,
          timeline: result.timeline,
        })
      );
    } else if (out !== '-') {
      io.stdout(
        `[${result.lang}] /${result.ipa}/ ${result.duration.toFixed(2)} s -> ${out}`
      );
    }
  },

  convert(values, positionals, io) {
    const [input] = positionals;
    if (!input) {
      throw new Error('Missing <in>');
    }
    if (!values.out) {
      throw new Error('Missing -o <out>');
    }
    const output = audioOutput(values, 'converted');
    const decoded = decodeAudio(readFileSync(input));
    const rate =
      optionalNumber(values['sample-rate'], 'sample-rate') ??
      decoded.sampleRate;
    const samples = resample(decoded.samples, decoded.sampleRate, rate);
    writeOutput(output.out, output.encode(samples, rate), io);
    if (output.out !== '-') {
      io.stdout(
        `${decoded.format} ${decoded.channels} ch ${decoded.sampleRate} Hz -> ${output.out} (${rate} Hz mono)`
      );
    }
  },

  timeline(values, positionals, io) {
    const prepared = prepareUtterance(requireText(positionals), {
      lang: values.lang,
      ...accentOptions(values),
      weakForms: values['strong-forms'] ? false : undefined,
      ipa: values.ipa,
      markup: markupOption(values),
      breaths: values.breaths || undefined,
    });
    reportWarnings(prepared, io);
    const { lang, accent, ipa, timeline, plan } = prepared;
    if (values.json) {
      io.stdout(
        JSON.stringify({
          lang,
          accent: accent ?? null,
          ipa,
          modes: plan.modes,
          sounds: plan.sounds,
          timeline,
        })
      );
      return;
    }
    for (const line of timelineLines(timeline)) {
      io.stdout(line);
    }
  },

  visemes(values, positionals, io) {
    const head = resolveHead(values);
    const { plan, head: resolved } = prepareUtterance(
      requireText(positionals),
      {
        lang: values.lang,
        ...accentOptions(values),
        weakForms: values['strong-forms'] ? false : undefined,
        ipa: values.ipa,
        markup: markupOption(values),
        breaths: values.breaths || undefined,
        head,
      }
    );
    const track = visemeTrack(plan, resolved, {
      format: values.format ?? 'arkit',
      fps: optionalNumber(values.fps, 'fps'),
    });
    const json = JSON.stringify(track);
    if (values.out && values.out !== '-') {
      writeFileSync(values.out, json);
      io.stdout(
        `${track.frames.length} ${track.format} frames at ${track.fps} fps -> ${values.out}`
      );
      return;
    }
    io.stdout(json);
  },

  head(values, positionals, io) {
    if (values['voice-file']) {
      io.stdout(JSON.stringify(headVoiceFile(values), null, 2));
      return;
    }
    const given = values.head !== undefined || values.voice !== undefined;
    const head =
      (given && resolveHead(values)) ||
      randomHeadConfig(values.seed ?? Date.now(), { preset: values.preset });
    io.stdout(
      values.json ? JSON.stringify(head, null, 2) : encodeHeadConfig(head)
    );
  },

  voice(values, positionals, io) {
    const [action, file] = positionals;
    if (action !== 'check' || !file) {
      throw new Error('Usage: voice-simulator voice check <file.json>');
    }
    const voice = readVoiceFile(file);
    const name = voice.name ? ` "${voice.name}"` : '';
    const accent = voice.accent?.code ?? voice.accent;
    const spoken = accent ? `, accent ${accent}` : '';
    io.stdout(`${file}${name}: ok, preset ${voice.preset ?? 'none'}${spoken}`);
  },

  mesh(values, positionals, io) {
    const head = resolveHead(values) ?? randomHeadConfig(1);
    const obj = headModelObj(head, { lod: optionalNumber(values.lod, 'lod') });
    writeOutput(values.out ?? 'head.obj', obj, io);
  },

  match(values, positionals, io, engine) {
    const [file] = positionals;
    if (!file) {
      throw new Error('Missing <file>');
    }
    const { samples, sampleRate } = decodeAudio(readFileSync(file));
    const result = matchVoice(samples, sampleRate, {
      preset: values.preset,
      transcript: values.transcript,
      lang: values.lang,
      iterations: optionalNumber(values.iterations, 'iterations'),
      engine,
    });
    if (values.json) {
      io.stdout(
        JSON.stringify({
          preset: result.preset,
          distance: result.distance,
          features: result.features,
          head: result.head,
        })
      );
      return;
    }
    const { features } = result;
    io.stdout(
      [
        `f0 ${features.f0.toFixed(0)} Hz`,
        `range ${features.f0Range.toFixed(1)} st`,
        `formants ${features.formants.map((value) => value.toFixed(0)).join('/')} Hz`,
        `H1-H2 ${features.h1h2.toFixed(1)} dB`,
        `HNR ${features.hnr.toFixed(1)} dB`,
        `${features.syllableRate.toFixed(1)} syllables/s`,
      ].join(', ')
    );
    io.stdout(`${result.preset}, distance ${result.distance.toFixed(2)}`);
    io.stdout(encodeHeadConfig(result.head));
  },

  compare(values, positionals, io) {
    const [referenceFile, testFile] = positionals;
    if (!referenceFile || !testFile) {
      throw new Error('Missing <reference> <test>');
    }
    const result = compareRecordings(
      decodeAudio(readFileSync(referenceFile)),
      decodeAudio(readFileSync(testFile))
    );
    if (values.json) {
      io.stdout(JSON.stringify(result));
      return;
    }
    for (const line of formatComparison(result)) {
      io.stdout(line);
    }
  },

  benchmark(values, positionals, io, engine) {
    if (values.quick) {
      return quickBenchmark(values, io, engine);
    }
    const seconds = optionalNumber(values.seconds, 'seconds') ?? 0.3;
    const repeats = optionalNumber(values.repeats, 'repeats') ?? 5;
    if (values.tier) {
      const tier = AUDIO_TIERS.find((entry) => entry.name === values.tier);
      if (!tier) {
        throw new Error(`Unknown tier: ${values.tier}`);
      }
      const load = measureAudioTier(tier, { seconds, repeats, engine });
      if (values.json) {
        io.stdout(
          JSON.stringify({ engine: engine.name, tier: tier.name, load })
        );
        return;
      }
      io.stdout(`engine: ${engine.name}`);
      io.stdout(`${tier.name}: load ${load.toFixed(3)}`);
      return;
    }
    const result = benchmarkAudioTiers({
      seconds,
      repeats,
      warmUp: 0.5,
      engine,
    });
    if (values.json) {
      io.stdout(JSON.stringify({ engine: engine.name, ...result }));
      return;
    }
    printTierLoads(result, io, engine);
  },

  serve(values, positionals, io, engine) {
    const port =
      optionalNumber(values.port ?? process.env.PORT, 'port') ?? 8080;
    const host = values.host ?? process.env.HOST ?? '127.0.0.1';
    const server = createVoiceServer({
      version: readVersion(),
      index: INDEX_PAGE,
      engine,
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const address = server.address();
        io.stdout(
          `voice-simulator listening on http://${host}:${address.port}`
        );
        io.onServer?.(server);
        server.once('close', () => resolve());
      });
    });
  },
};

/**
 * Run the CLI.
 * @param {string[]} argv Arguments without the node and script paths.
 * @param {{stderr?: Function, stdout?: Function, stdoutBytes?: Function, onServer?: Function}} [io]
 * @returns {Promise<number>} Exit code.
 */
export async function runCli(argv, io = {}) {
  const streams = {
    stderr: io.stderr ?? console.error,
    stdout: io.stdout ?? console.log,
    stdoutBytes: io.stdoutBytes ?? ((data) => process.stdout.write(data)),
    onServer: io.onServer,
  };
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
    });
    const [command, ...rest] = positionals;
    if (values.version) {
      streams.stdout(readVersion());
      return 0;
    }
    if (!command || values.help) {
      streams.stdout(usage());
      return 0;
    }
    const handler = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
    if (!handler) {
      streams.stderr(`Unknown command: ${command}`);
      streams.stderr(usage());
      return 1;
    }
    loadLexiconFiles(values.lexicon, values.lang);
    // Loaded once, before the command: every render of it uses this engine.
    const engine = await createEngine(engineFlags(values));
    await handler(values, rest, streams, engine);
    return 0;
  } catch (error) {
    streams.stderr(error.message);
    return 1;
  }
}

function isCliEntryPoint() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isCliEntryPoint()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
