//! Segmental decoder parity entry point.
use crate::{error, f64_slice};
use voice_simulator_core::decode::{
    committed_prefix, prepare, search, transition_costs, Arc, Bounds, LanguageModel, Observations,
    Policy, Template, Weights, CHANNELS,
};

fn integer(value: f64, max: usize) -> Option<usize> {
    let whole = value as usize;
    (whole <= max && whole as f64 == value).then_some(whole)
}

fn take<'a>(data: &mut &'a [f64], count: usize) -> Option<&'a [f64]> {
    let (part, rest) = data.split_at_checked(count)?;
    *data = rest;
    Some(part)
}

fn arc_values(arc: Arc) -> [f64; 6] {
    [
        arc.from as f64,
        arc.to as f64,
        arc.unit as f64,
        arc.cost,
        arc.confidence,
        u8::from(arc.long).into(),
    ]
}

fn decode(mut data: &[f64]) -> Option<Vec<f64>> {
    let args = take(&mut data, 16)?;
    let (duration, hop, clock) = (args[0], args[1], args[2]);
    let frames = integer(args[3], 2000)?;
    let landmark_count = integer(args[4], 2000)?;
    let units = integer(args[5], 128)?;
    let model_count = integer(args[6], 4)?;
    let beam = integer(args[7], 128)?;
    let nbest = integer(args[8], 10)?;
    let open = integer(args[12], 1)? != 0;
    let from = args[13];
    let locked = integer(args[14], 1)? != 0;
    let last_unit = integer(args[15], units)?;
    if args.iter().any(|x| !x.is_finite())
        || from < 0.0
        || duration < from
        || hop <= 0.0
        || clock < 0.0
        || units == 0
        || beam == 0
        || nbest == 0
        || args[9..12].iter().any(|&weight| weight < 0.0)
    {
        return None;
    }
    let ranges: [f64; CHANNELS] = take(&mut data, CHANNELS)?.try_into().ok()?;
    if ranges.iter().any(|x| !x.is_finite() || *x <= 0.0) {
        return None;
    }
    let mut speech = Vec::with_capacity(frames);
    let mut classes = Vec::with_capacity(frames);
    let mut values = Vec::with_capacity(frames);
    let mut variance = Vec::with_capacity(frames);
    for _ in 0..frames {
        speech.push(integer(*take(&mut data, 1)?.first()?, 1)? as u8);
        classes.push(integer(*take(&mut data, 1)?.first()?, 7)? as u8);
        let means: [f64; CHANNELS] = take(&mut data, CHANNELS)?.try_into().ok()?;
        let spreads: [f64; CHANNELS] = take(&mut data, CHANNELS)?.try_into().ok()?;
        if means.iter().any(|x| !x.is_finite()) || spreads.iter().any(|&x| x.is_nan() || x < 0.0) {
            return None;
        }
        values.push(means);
        variance.push(spreads);
    }
    let landmarks = take(&mut data, landmark_count)?;
    if landmarks.iter().any(|x| !x.is_finite()) {
        return None;
    }
    let mut templates = Vec::with_capacity(units);
    for _ in 0..units {
        let header = take(&mut data, 3)?;
        let count = integer(header[2], CHANNELS * 5)?;
        if header[0] <= 0.0 || !header[0].is_finite() || count == 0 {
            return None;
        }
        let mut compared = Vec::with_capacity(count);
        for pair in take(&mut data, 2 * count)?.as_chunks::<2>().0 {
            if !pair[1].is_finite() {
                return None;
            }
            compared.push((integer(pair[0], CHANNELS * 5 - 1)?, pair[1]));
        }
        templates.push(Template {
            duration: header[0],
            classes: integer(header[1], 255)? as u8,
            compared,
        });
    }
    let mut tables = Vec::with_capacity(model_count);
    for _ in 0..model_count {
        let width = integer(take(&mut data, 1)?[0], 129)?;
        if width == 0 {
            return None;
        }
        let ids = take(&mut data, units)?
            .iter()
            .map(|&id| {
                if id == -1.0 {
                    Some(None)
                } else {
                    integer(id, width.saturating_sub(2)).map(Some)
                }
            })
            .collect::<Option<Vec<_>>>()?;
        let counts = take(&mut data, width * width)?
            .iter()
            .map(|&count| integer(count, u16::MAX as usize).map(|n| n as u16))
            .collect::<Option<Vec<_>>>()?;
        tables.push((width, ids, counts));
    }
    if !data.is_empty() || (frames > 0 && ((frames - 1) as f64 * hop > duration + 1e-9)) {
        return None;
    }
    let models: Vec<_> = tables
        .iter()
        .map(|(width, ids, counts)| LanguageModel {
            width: *width,
            ids,
            counts,
        })
        .collect();
    let graph = prepare(
        &Observations {
            start: 0.0,
            hop,
            speech: &speech,
            classes: &classes,
            landmarks,
            values: &values,
            variance: &variance,
            ranges,
        },
        &templates,
        &Bounds {
            from,
            to: duration,
            open,
            locked,
        },
    );
    let weights = Weights {
        duration: args[9],
        class: args[10],
        phonotactic: args[11],
    };
    let costs = transition_costs(units, &models);
    if costs.iter().any(|x| !x.is_finite()) {
        return None;
    }
    let result = search(
        &graph,
        &Policy {
            units,
            beam,
            nbest,
            last_unit,
            weights,
            transition: &costs,
        },
    );
    let best = if open && result.readings.is_empty() {
        result.provisional.as_ref()
    } else {
        result.readings.first()
    };
    let fixed = best.map_or(0, |best| {
        committed_prefix(best, &result.frontier, &graph.times, clock, !open)
    });
    let mut out = vec![
        graph.times.len() as f64,
        result.edges.len() as f64,
        result.readings.len() as f64,
        fixed as f64,
    ];
    out.extend(costs);
    out.extend(graph.times);
    out.extend(result.edges.into_iter().flat_map(arc_values));
    for reading in result.readings {
        out.extend([reading.cost, reading.arcs.len() as f64]);
        out.extend(reading.arcs.into_iter().flat_map(arc_values));
    }
    Some(out)
}

/// Input is a header, channel ranges, frame rows, landmarks, templates and
/// phonotactic tables. Output is a header, transition matrix, boundaries,
/// lattice arcs, and readings (each with path cost and arcs).
#[no_mangle]
pub extern "C" fn vs_ipa_decode(input: u32, len: u32, output: u32, capacity: u32) -> i32 {
    let data = match f64_slice(input, len) {
        Ok(values) => values,
        Err(code) => return code,
    };
    let Some(result) = decode(data) else {
        return error::BAD_ARGUMENT;
    };
    if result.len() > capacity as usize {
        return error::BAD_ARGUMENT;
    }
    match f64_slice(output, capacity) {
        Ok(out) => {
            out[..result.len()].copy_from_slice(&result);
            result.len() as i32
        }
        Err(code) => code,
    }
}
