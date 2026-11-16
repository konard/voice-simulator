//! `voice-simulator-cli`: the command line tool of the Rust engine.
//!
//! Arguments are parsed by hand (no dependencies besides the core). The
//! commands are `version`, `random`, `render-job` (issue 22, with
//! `--threads` of issue 24) and `kernel-steps` (issue 24).

mod render_job;
mod sha256;

use std::io::{self, BufWriter, Write};
use std::process::ExitCode;
use std::time::Instant;

use voice_simulator_core::random::{hash_seed_utf16, Random};

const USAGE: &str = "\
Usage: voice-simulator-cli <command> [arguments]

Commands:
  version                 Print the version
  random <seed> <count>   Print <count> values of createRandom(<seed>) of
                          src/random.js, one per line, as the 16 hexadecimal
                          digits of their f64 bits. A seed of decimal digits
                          (with an optional minus sign) is a number, reduced
                          to 32 bits like `seed >>> 0`; any other seed is a
                          string, hashed like hashSeed(string).
  render-job <file> [--threads <n|auto>]
                          Render a job of scripts/write-render-job.mjs
                          (little-endian f64 values: config length, config,
                          model length in bytes, packed voxel model, frame
                          count, frames, sample count) with the renderer of
                          the job (the waveguide, or the 3D FDTD solver
                          with its model), natively, in one call. Prints
                          the SHA-256 of the samples (their f32
                          little-endian bytes), the number of samples, the
                          seconds the render took, its real-time factor and
                          the threads that stepped the solver. --threads
                          (default 1) steps the 3D solver on <n> threads,
                          or with auto on all cores but one; grids with
                          fewer links than THREAD_MIN_LINKS stay on one
                          thread. The samples are the same bits with any
                          number of threads.
  kernel-steps <file> <count> [--threads <n|auto>]
                          Render the first 2400 samples of a render job of
                          the 3D solver, then time <count> bare steps of
                          its grid (no sources), the kernel of
                          tests/heavy/performance-threads.test.js. Prints
                          the seconds, the steps per second, the threads,
                          the links and cells of the grid and the SHA-256
                          of the bits of the pressure field after the steps
                          (the same with any number of threads).
  help                    Print this help
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    match run(&words, &mut io::stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(Failure::Usage(message)) => {
            eprintln!("voice-simulator-cli: {message}\n\n{USAGE}");
            ExitCode::from(2)
        }
        Err(Failure::Job(message)) => {
            eprintln!("voice-simulator-cli: {message}");
            ExitCode::FAILURE
        }
        Err(Failure::Io(error)) if error.kind() == io::ErrorKind::BrokenPipe => ExitCode::SUCCESS,
        Err(Failure::Io(error)) => {
            eprintln!("voice-simulator-cli: {error}");
            ExitCode::FAILURE
        }
    }
}

#[derive(Debug)]
enum Failure {
    Usage(String),
    Job(String),
    Io(io::Error),
}

impl From<io::Error> for Failure {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

fn run(args: &[&str], out: &mut impl Write) -> Result<(), Failure> {
    match args {
        ["version"] | ["--version"] | ["-V"] => {
            writeln!(out, "voice-simulator-cli {}", env!("CARGO_PKG_VERSION"))?;
            Ok(())
        }
        ["help"] | ["--help"] | ["-h"] => {
            write!(out, "{USAGE}")?;
            Ok(())
        }
        ["random", seed, count] => {
            let count: u64 = count.parse().map_err(|_| {
                Failure::Usage(format!(
                    "count must be a non-negative integer, got {count:?}"
                ))
            })?;
            let mut random = Random::new(parse_seed(seed));
            let mut out = BufWriter::new(out);
            for _ in 0..count {
                writeln!(out, "{:016x}", random.next().to_bits())?;
            }
            out.flush()?;
            Ok(())
        }
        ["random", ..] => Err(Failure::Usage("random needs <seed> and <count>".into())),
        ["render-job", rest @ ..] => {
            let (file, threads) = parse_render_job(rest)?;
            let bytes = std::fs::read(file)?;
            let job = render_job::parse(&bytes).map_err(Failure::Job)?;
            let started = Instant::now();
            let rendered = render_job::render(&job, threads).map_err(Failure::Job)?;
            let seconds = started.elapsed().as_secs_f64();
            let samples = rendered.samples;
            let duration = samples.len() as f64 / job.config.first().copied().unwrap_or(1.0);
            writeln!(out, "sha256 {}", render_job::fingerprint(&samples))?;
            writeln!(out, "samples {}", samples.len())?;
            writeln!(out, "seconds {seconds:.6}")?;
            writeln!(out, "rtf {:.6}", seconds / duration)?;
            writeln!(out, "threads {}", rendered.threads)?;
            Ok(())
        }
        ["kernel-steps", rest @ ..] => {
            let (words, threads) = parse_threads_option(rest)?;
            let [file, count] = words[..] else {
                return Err(Failure::Usage(
                    "kernel-steps needs <file> and <count>".into(),
                ));
            };
            let count: usize = count.parse().map_err(|_| {
                Failure::Usage(format!(
                    "count must be a non-negative integer, got {count:?}"
                ))
            })?;
            let bytes = std::fs::read(file)?;
            let job = render_job::parse(&bytes).map_err(Failure::Job)?;
            let run = render_job::kernel_steps(&job, count, threads).map_err(Failure::Job)?;
            writeln!(out, "seconds {:.6}", run.seconds)?;
            writeln!(out, "steps_per_second {:.3}", count as f64 / run.seconds)?;
            writeln!(out, "threads {}", run.threads)?;
            writeln!(out, "links {}", run.links)?;
            writeln!(out, "cells {}", run.cells)?;
            writeln!(out, "field_sha256 {}", run.field_sha256)?;
            Ok(())
        }
        [] => Err(Failure::Usage("no command given".into())),
        [command, ..] => Err(Failure::Usage(format!("unknown command {command:?}"))),
    }
}

/// The file and the thread count of `render-job <file> [--threads <n|auto>]`
/// (the option may come first).
fn parse_render_job<'a>(args: &[&'a str]) -> Result<(&'a str, usize), Failure> {
    let (words, threads) = parse_threads_option(args)?;
    match words[..] {
        [file] => Ok((file, threads)),
        [] => Err(Failure::Usage("render-job needs <file>".into())),
        _ => Err(Failure::Usage("render-job takes one <file>".into())),
    }
}

/// The words of `args` and the value of its `--threads <n|auto>` (or
/// `--threads=<n|auto>`) option, 1 without one.
fn parse_threads_option<'a>(args: &[&'a str]) -> Result<(Vec<&'a str>, usize), Failure> {
    let mut words = Vec::new();
    let mut threads = 1;
    let mut rest = args.iter();
    while let Some(&word) = rest.next() {
        if let Some(value) = word.strip_prefix("--threads") {
            let value = match value.strip_prefix('=') {
                Some(value) => value,
                None if value.is_empty() => rest
                    .next()
                    .copied()
                    .ok_or_else(|| Failure::Usage("--threads needs <n|auto>".into()))?,
                None => return Err(Failure::Usage(format!("unknown option {word:?}"))),
            };
            threads = parse_threads(value)?;
        } else if word.starts_with("--") {
            return Err(Failure::Usage(format!("unknown option {word:?}")));
        } else {
            words.push(word);
        }
    }
    Ok((words, threads))
}

/// `--threads`: a positive integer, or `auto` for all cores but one.
fn parse_threads(value: &str) -> Result<usize, Failure> {
    if value == "auto" {
        return Ok(render_job::auto_threads());
    }
    match value.parse::<usize>() {
        Ok(threads) if threads > 0 => Ok(threads),
        _ => Err(Failure::Usage(format!(
            "--threads must be a positive integer or auto, got {value:?}"
        ))),
    }
}

/// `hashSeed` of `src/random.js` for a seed typed on the command line.
fn parse_seed(text: &str) -> u32 {
    let digits = text.strip_prefix('-').unwrap_or(text);
    let numeric = !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit());
    if numeric {
        // `value >>> 0`: the integer modulo 2^32, computed digit by digit so
        // that any length works.
        let magnitude = digits.bytes().fold(0u32, |acc, byte| {
            acc.wrapping_mul(10).wrapping_add(u32::from(byte - b'0'))
        });
        return if text.starts_with('-') {
            magnitude.wrapping_neg()
        } else {
            magnitude
        };
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    hash_seed_utf16(&units)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output(args: &[&str]) -> String {
        let mut buffer = Vec::new();
        run(args, &mut buffer).expect("command succeeds");
        String::from_utf8(buffer).expect("UTF-8 output")
    }

    #[test]
    fn random_prints_the_bits_of_create_random() {
        // createRandom(1) in Node.js, bits read through a DataView.
        assert_eq!(
            output(&["random", "1", "3"]),
            "3fe410fd5e600000\n3f66693920000000\n3fe0e0d89d600000\n"
        );
    }

    #[test]
    fn seeds_follow_hash_seed() {
        assert_eq!(parse_seed("42"), 42);
        assert_eq!(parse_seed("-1"), u32::MAX);
        assert_eq!(parse_seed("4294967297"), 1);
        // hashSeed('voice') in Node.js.
        assert_eq!(parse_seed("voice"), 2_140_916_217);
        assert_eq!(parse_seed("-"), hash_seed_utf16(&[u16::from(b'-')]));
    }

    #[test]
    fn threads_are_parsed() {
        let parse = |args: &[&'static str]| match parse_render_job(args) {
            Ok(parsed) => parsed,
            Err(error) => panic!("{args:?}: {error:?}"),
        };
        assert_eq!(parse(&["job.bin"]), ("job.bin", 1));
        assert_eq!(parse(&["job.bin", "--threads", "4"]), ("job.bin", 4));
        assert_eq!(parse(&["--threads=3", "job.bin"]), ("job.bin", 3));
        let (_, auto) = parse(&["job.bin", "--threads", "auto"]);
        assert!(auto >= 1);
    }

    #[test]
    fn version_names_the_tool() {
        assert!(output(&["version"]).starts_with("voice-simulator-cli "));
    }

    #[test]
    fn bad_arguments_are_usage_errors() {
        let mut sink = Vec::new();
        assert!(matches!(
            run(&["random", "1"], &mut sink),
            Err(Failure::Usage(_))
        ));
        assert!(matches!(
            run(&["random", "1", "x"], &mut sink),
            Err(Failure::Usage(_))
        ));
        assert!(matches!(run(&["nope"], &mut sink), Err(Failure::Usage(_))));
        for args in [
            &["render-job"][..],
            &["render-job", "job.bin", "--threads"],
            &["render-job", "job.bin", "--threads", "0"],
            &["render-job", "job.bin", "--threads", "many"],
            &["render-job", "job.bin", "--fast"],
            &["render-job", "a.bin", "b.bin"],
        ] {
            assert!(
                matches!(run(args, &mut sink), Err(Failure::Usage(_))),
                "{args:?}"
            );
        }
        assert!(matches!(run(&[], &mut sink), Err(Failure::Usage(_))));
    }
}
