#!/usr/bin/env node

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  AUDIO_FORMAT_NAMES,
  AUDIO_TIERS,
  DEFAULT_AUDIO_TIER,
  audioEncoding,
  ROOM_PRESETS,
  benchmarkAudioTiers,
  decodeAudio,
  decodeHeadConfig,
  encodeHeadConfig,
  formatFromFileName,
  headModelObj,
  matchVoice,
  measureAudioTier,
  prepareUtterance,
  randomHeadConfig,
  resample,
  synthesize,
  textToIpa,
} from '../src/index.js';
import { INDEX_PAGE, createVoiceServer } from '../src/server/server.js';

const OPTIONS = {
  lang: { type: 'string', short: 'l' },
  accent: { type: 'string' },
  out: { type: 'string', short: 'o' },
  tier: { type: 'string', short: 't' },
  solver: { type: 'string' },
  dx: { type: 'string' },
  seed: { type: 'string', short: 's' },
  head: { type: 'string' },
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
  lod: { type: 'string' },
  seconds: { type: 'string' },
  port: { type: 'string', short: 'p' },
  host: { type: 'string' },
  transcript: { type: 'string' },
  iterations: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function usage() {
  return [
    'Usage: voice-simulator <command> [options]',
    '',
    'Commands:',
    '  ipa <text>          Print the IPA transcription (en, ru, hi, zh)',
    '  say <text> -o f.wav Simulate speech and write an audio file',
    '  convert <in> -o out Convert an audio file (WAV, FLAC, AIFF, AU) to mono',
    '  timeline <text>     Print when each word and syllable is spoken',
    '  head                Print a random head configuration',
    '  mesh -o head.obj    Export the low-poly head model as OBJ',
    '  match <file>        Find the head that sounds like a recording',
    '  benchmark           Measure the audio LOD tiers on this machine',
    '  serve               Start the HTTP API (with streaming)',
    '',
    'Options:',
    '  -l, --lang <code>     auto | en | ru | hi | zh (default auto)',
    '      --accent <code>   English accent: en-US | en-GB | en-AU | en-IN',
    '  -o, --out <file>      Output file ("-" for stdout)',
    `  -t, --tier <name>     ${AUDIO_TIERS.map((tier) => tier.name).join(' | ')}`,
    `                        (default ${DEFAULT_AUDIO_TIER}: 3D; medium: real-time waveguide)`,
    '      --solver <name>   waveguide | fdtd3d (overrides the tier)',
    '      --dx <cm>         FDTD voxel size',
    '  -s, --seed <seed>     Random seed for the head and the voice',
    '      --head <value>    "random" or an encoded head (key=value&...)',
    '      --preset <name>   any | male | female | child (random head range)',
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
    '      --lod <0-3>      Mesh level of detail',
    '  -p, --port <port>     Server port (default 8080, env PORT)',
    '      --host <host>     Server host (default 127.0.0.1, env HOST)',
    '      --json            Machine-readable output',
    '  -h, --help            Show this help',
    '  -v, --version         Show package version',
  ].join('\n');
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

function resolveHead(values) {
  if (values.head && values.head !== 'random') {
    return decodeHeadConfig(values.head);
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

const COMMANDS = {
  ipa(values, positionals, io) {
    const result = textToIpa(requireText(positionals), {
      lang: values.lang,
      accent: values.accent,
    });
    io.stdout(values.json ? JSON.stringify(result) : result.ipa);
  },

  say(values, positionals, io) {
    const output = audioOutput(values, 'voice');
    const result = synthesize(requireText(positionals), {
      lang: values.lang,
      accent: values.accent,
      ipa: values.ipa,
      seed: values.seed,
      head: resolveHead(values),
      tier: values.tier,
      solver: values.solver,
      dx: optionalNumber(values.dx, 'dx'),
      output: values.output,
      sampleRate: optionalNumber(values['sample-rate'], 'sample-rate'),
      ...listeningOptions(values),
    });
    const { out } = output;
    writeOutput(out, output.encode(result.samples, result.sampleRate), io);
    if (out !== '-' && values.json) {
      io.stdout(
        JSON.stringify({
          lang: result.lang,
          accent: result.accent,
          ipa: result.ipa,
          duration: result.duration,
          out,
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
      accent: values.accent,
      ipa: values.ipa,
    });
    const { lang, accent, ipa, timeline } = prepared;
    if (values.json) {
      io.stdout(
        JSON.stringify({ lang, accent: accent ?? null, ipa, timeline })
      );
      return;
    }
    for (const word of timeline.words) {
      const syllables = word.syllables
        .map((syllable) => syllable.text ?? syllable.ipa)
        .join('·');
      io.stdout(
        `${word.start.toFixed(3)} ${word.end.toFixed(3)} ${word.text} /${word.syllables.map((syllable) => syllable.ipa).join('.')}/ ${syllables}`
      );
    }
  },

  head(values, positionals, io) {
    const head = randomHeadConfig(values.seed ?? Date.now(), {
      preset: values.preset,
    });
    io.stdout(
      values.json ? JSON.stringify(head, null, 2) : encodeHeadConfig(head)
    );
  },

  mesh(values, positionals, io) {
    const head = resolveHead(values) ?? randomHeadConfig(1);
    const obj = headModelObj(head, { lod: optionalNumber(values.lod, 'lod') });
    writeOutput(values.out ?? 'head.obj', obj, io);
  },

  match(values, positionals, io) {
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

  benchmark(values, positionals, io) {
    const seconds = optionalNumber(values.seconds, 'seconds') ?? 0.3;
    if (values.tier) {
      const tier = AUDIO_TIERS.find((entry) => entry.name === values.tier);
      if (!tier) {
        throw new Error(`Unknown tier: ${values.tier}`);
      }
      const load = measureAudioTier(tier, { seconds });
      io.stdout(`${tier.name}: load ${load.toFixed(3)}`);
      return;
    }
    const result = benchmarkAudioTiers({ seconds });
    if (values.json) {
      io.stdout(JSON.stringify(result));
      return;
    }
    result.loads.forEach((load, index) => {
      const note = result.measured[index] ? '' : ' (predicted, not run)';
      io.stdout(`${AUDIO_TIERS[index].name}: load ${load.toFixed(3)}${note}`);
    });
    io.stdout(`selected: ${result.tier.name}`);
  },

  serve(values, positionals, io) {
    const port =
      optionalNumber(values.port ?? process.env.PORT, 'port') ?? 8080;
    const host = values.host ?? process.env.HOST ?? '127.0.0.1';
    const server = createVoiceServer({
      version: readVersion(),
      index: INDEX_PAGE,
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
    await handler(values, rest, streams);
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
