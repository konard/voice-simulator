//! `voice-simulator-cli`: the command line tool of the Rust engine.
//!
//! Arguments are parsed by hand (no dependencies besides the core). Later
//! issues add commands that render; this one has `version` and `random`.

use std::io::{self, BufWriter, Write};
use std::process::ExitCode;

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
        [] => Err(Failure::Usage("no command given".into())),
        [command, ..] => Err(Failure::Usage(format!("unknown command {command:?}"))),
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
        assert!(matches!(run(&[], &mut sink), Err(Failure::Usage(_))));
    }
}
