//! Read little-endian PCM and float RIFF/WAVE for native recognition (Unlicense).
use std::io::{self, Read, Seek, SeekFrom};

fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "expected PCM or float RIFF/WAVE",
    )
}

fn word(bytes: &[u8]) -> u16 {
    u16::from_le_bytes(bytes.try_into().unwrap())
}

fn dword(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes.try_into().unwrap())
}

struct Format {
    tag: u16,
    channels: usize,
    rate: u32,
    bytes: usize,
}

fn format(input: &mut impl Read, length: u32) -> io::Result<Format> {
    if length < 16 {
        return Err(invalid());
    }
    let mut data = [0; 40];
    input.read_exact(&mut data[..length.min(40) as usize])?;
    let mut tag = word(&data[..2]);
    if tag == 0xfffe && length >= 40 {
        tag = word(&data[24..26]);
    }
    let channels = usize::from(word(&data[2..4]));
    let rate = dword(&data[4..8]);
    let bits = word(&data[14..16]);
    let bytes = usize::from(bits / 8);
    if !(8000..=192000).contains(&rate)
        || channels == 0
        || channels * bytes != usize::from(word(&data[12..14]))
        || !matches!((tag, bits), (1, 8 | 16 | 24 | 32) | (3, 32 | 64))
    {
        return Err(invalid());
    }
    Ok(Format {
        tag,
        channels,
        rate,
        bytes,
    })
}

fn sample(bytes: &[u8], tag: u16) -> f64 {
    match (tag, bytes.len()) {
        (1, 1) => (f64::from(bytes[0]) - 128.0) / 128.0,
        (1, 2) => f64::from(i16::from_le_bytes(bytes.try_into().unwrap())) / 32768.0,
        (1, 3) => f64::from(i32::from_le_bytes([0, bytes[0], bytes[1], bytes[2]])) / 2147483648.0,
        (1, 4) => f64::from(i32::from_le_bytes(bytes.try_into().unwrap())) / 2147483648.0,
        (3, 4) => f64::from(f32::from_le_bytes(bytes.try_into().unwrap())),
        (3, 8) => f64::from_le_bytes(bytes.try_into().unwrap()),
        _ => unreachable!(),
    }
}

pub fn read(input: &mut (impl Read + Seek)) -> io::Result<(Vec<f32>, u32)> {
    let mut header = [0; 12];
    input.read_exact(&mut header)?;
    if &header[..4] != b"RIFF" || &header[8..] != b"WAVE" {
        return Err(invalid());
    }
    let end = (u64::from(dword(&header[4..8])) + 8).min(input.seek(SeekFrom::End(0))?);
    input.seek(SeekFrom::Start(12))?;
    let mut settings = None;
    let mut data = None;
    while input.stream_position()? + 8 <= end {
        let mut chunk = [0; 8];
        input.read_exact(&mut chunk)?;
        let length = dword(&chunk[4..]);
        let start = input.stream_position()?;
        if start + u64::from(length) > end {
            return Err(invalid());
        }
        match &chunk[..4] {
            b"fmt " => settings = Some(format(input, length)?),
            b"data" => data = Some((start, length as usize)),
            _ => {}
        }
        if settings.is_some() && data.is_some() {
            break;
        }
        input.seek(SeekFrom::Start(
            start + u64::from(length) + u64::from(length % 2),
        ))?;
    }
    let settings = settings.ok_or_else(invalid)?;
    let (start, length) = data.ok_or_else(invalid)?;
    let stride = settings.channels * settings.bytes;
    if length % stride != 0 {
        return Err(invalid());
    }
    input.seek(SeekFrom::Start(start))?;
    let mut buffer = vec![0; stride * 128];
    let mut output = Vec::with_capacity(length / stride);
    let mut remaining = length;
    while remaining > 0 {
        let n = remaining.min(buffer.len());
        input.read_exact(&mut buffer[..n])?;
        for row in buffer[..n].chunks_exact(stride) {
            let value = (row
                .chunks_exact(settings.bytes)
                .map(|bytes| sample(bytes, settings.tag))
                .sum::<f64>()
                / settings.channels as f64) as f32;
            if !value.is_finite() {
                return Err(invalid());
            }
            output.push(value);
        }
        remaining -= n;
    }
    Ok((output, settings.rate))
}
