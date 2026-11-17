//! Depth-averaged 2D FDTD sheet, port of `acoustics/fdtd2d.js`.
use crate::{
    frame,
    glottis::SPEED_OF_SOUND,
    losses::boundary_loss_factor,
    math::{self, max, min},
    nose_line::NoseLine,
    radiation::RADIATION_RESISTANCE,
    sheet::Sheet,
    solver::Solver,
};
use alloc::{vec, vec::Vec};
use core::f64::consts::PI;

const COURANT: f64 = 0.68;
#[derive(Clone, Debug)]
struct Port {
    line: NoseLine,
    column: usize,
    mean: f64,
    left: f64,
}

/// Pressure in cell centres and particle velocity on their faces.
#[derive(Clone, Debug)]
pub struct Fdtd2d {
    sheet: Sheet,
    length: f64,
    dt: f64,
    wall_loss: f64,
    face_exponent: f64,
    wall_admittance: f64,
    glottis_admittance: f64,
    pressure: Vec<f64>,
    divergence: Vec<f64>,
    keep: Vec<f64>,
    gain: Vec<f64>,
    velocity_x: Vec<f64>,
    depth_x: Vec<f64>,
    damping_x: Vec<f64>,
    velocity_y: Vec<f64>,
    depth_y: Vec<f64>,
    damping_y: Vec<f64>,
    lip_flow: Vec<f64>,
    lip_current: Vec<f64>,
    lip_step: f64,
    half_step: f64,
    ports: Vec<Port>,
    dirty: bool,
    area_count: usize,
    burst_input: f64,
    burst_state: f64,
    burst_leak: f64,
    last_flow: f64,
    source_gain: f64,
}
impl Fdtd2d {
    /// Unpack the static anatomical grid; dynamic geometry is computed here.
    pub fn new(
        bytes: &[u8],
        length: f64,
        wall_loss: f64,
        nasal_loss: f64,
        reflection: f64,
        nose: &[f64],
    ) -> Option<Self> {
        if !bytes.len().is_multiple_of(8) {
            return None;
        }
        let values: Vec<f64> = bytes
            .as_chunks::<8>()
            .0
            .iter()
            .map(|v| f64::from_le_bytes(*v))
            .collect();
        if values.len() < 5 || !values.iter().all(|v| v.is_finite() && *v >= 0.0) {
            return None;
        }
        let (dx, rows, columns, nose_n, branches) = (
            values[0],
            values[1] as usize,
            values[2] as usize,
            values[3] as usize,
            values[4] as usize,
        );
        if values[1..5].iter().any(|v| math::floor(*v) != *v)
            || dx <= 0.0
            || rows < 2
            || columns < 4
            || rows.checked_mul(columns)? > 1 << 20
            || !(2..=4096).contains(&nose_n)
            || branches > 64
            || values.len() != 5 + columns + 3 * branches
            || nose.is_empty()
        {
            return None;
        }
        let sheet = Sheet::new(dx, rows, values[5..5 + columns].to_vec());
        let rest_length = columns as f64 * dx;
        let exponent = (44.0 * COURANT) / columns as f64;
        let mut ports = vec![Port {
            line: NoseLine::new(nose_n, wall_loss * nasal_loss, exponent, false, nose, 0.0),
            column: 0,
            mean: 0.0,
            left: 0.0,
        }];
        for branch in values[5 + columns..].as_chunks::<3>().0 {
            let column = branch[0] as usize;
            let n = branch[2] as usize;
            if math::floor(branch[0]) != branch[0]
                || math::floor(branch[2]) != branch[2]
                || column >= columns
                || !(2..=4096).contains(&n)
            {
                return None;
            }
            ports.push(Port {
                line: NoseLine::new(
                    n,
                    wall_loss,
                    exponent,
                    true,
                    &[branch[1], branch[1]],
                    branch[1],
                ),
                column,
                mean: 0.0,
                left: 0.0,
            });
        }
        let cells = rows * columns;
        let x = (columns - 1) * rows;
        let y = columns * (rows - 1);
        let dt = (COURANT * dx) / SPEED_OF_SOUND;
        Some(Self {
            sheet,
            length,
            dt,
            wall_loss,
            face_exponent: 2.0 * exponent,
            wall_admittance: (0.0004 * wall_loss * 44.0) / (rest_length * math::sqrt(PI)),
            glottis_admittance: (1.0 - reflection) / (1.0 + reflection),
            pressure: vec![0.0; cells],
            divergence: vec![0.0; cells],
            keep: vec![0.0; cells],
            gain: vec![0.0; cells],
            velocity_x: vec![0.0; x],
            depth_x: vec![0.0; x],
            damping_x: vec![0.0; x],
            velocity_y: vec![0.0; y],
            depth_y: vec![0.0; y],
            damping_y: vec![0.0; y],
            lip_flow: vec![0.0; rows],
            lip_current: vec![0.0; rows],
            lip_step: 0.0,
            half_step: 0.0,
            ports,
            dirty: true,
            area_count: 44,
            burst_input: 0.0,
            burst_state: 0.0,
            burst_leak: 1.0 - dt / 0.008,
            last_flow: 0.0,
            source_gain: 0.0,
        })
    }
    fn face_damping(&self, area: f64) -> f64 {
        let smooth = boundary_loss_factor(area, self.wall_loss)
            + (0.0004 * self.wall_loss) / math::sqrt(max(area, 0.05));
        math::pow(max(0.0, smooth), self.face_exponent)
    }
    fn update(&mut self) {
        self.dirty = false;
        let (columns, rows, dx) = (self.sheet.columns, self.sheet.rows, self.sheet.dx);
        for c in 0..columns - 1 {
            let damping = self.face_damping(min(self.sheet.areas[c], self.sheet.areas[c + 1]));
            for r in 0..rows {
                let face = c * rows + r;
                let a = self.sheet.h[face];
                let b = self.sheet.h[face + rows];
                let depth = if a > 0.0 && b > 0.0 {
                    (2.0 * a * b) / (a + b)
                } else {
                    0.0
                };
                self.depth_x[face] = depth;
                self.damping_x[face] = if depth > 0.0 { damping } else { 0.0 };
                if depth == 0.0 {
                    self.velocity_x[face] = 0.0;
                }
            }
        }
        for c in 0..columns {
            let damping = self.face_damping(self.sheet.areas[c]);
            for r in 0..rows - 1 {
                let face = c * (rows - 1) + r;
                let a = self.sheet.h[c * rows + r];
                let b = self.sheet.h[c * rows + r + 1];
                let depth = if a > 0.0 && b > 0.0 {
                    (2.0 * a * b) / (a + b)
                } else {
                    0.0
                };
                self.depth_y[face] = depth;
                self.damping_y[face] = if depth > 0.0 { damping } else { 0.0 };
                if depth == 0.0 {
                    self.velocity_y[face] = 0.0;
                }
            }
        }
        let step_time = self.step_duration();
        let rest_length = columns as f64 * dx;
        let radius = math::sqrt(max(self.sheet.lip_area, 1e-4) / PI);
        let half_cell = (dx / 2.0) * (self.length / rest_length);
        self.half_step = (step_time * SPEED_OF_SOUND) / half_cell;
        self.lip_step = (step_time * SPEED_OF_SOUND * 3.0 * PI) / (8.0 * radius);
        let mut port_admittance = vec![0.0; columns];
        for port in &self.ports {
            if port.line.open() {
                port_admittance[port.column] +=
                    port.line.port_area / max(self.sheet.areas[port.column], 1e-4);
            }
        }
        let h = &self.sheet.h;
        for (c, port) in port_admittance.iter().enumerate() {
            for r in 0..rows {
                let i = c * rows + r;
                let depth = h[i];
                if depth <= 0.0 {
                    self.keep[i] = 0.0;
                    self.gain[i] = 0.0;
                    self.pressure[i] = 0.0;
                    continue;
                }
                let walls = usize::from(r == 0 || h[i - 1] <= 0.0)
                    + usize::from(r == rows - 1 || h[i + 1] <= 0.0)
                    + usize::from(c > 0 && h[i - rows] <= 0.0)
                    + usize::from(c < columns - 1 && h[i + rows] <= 0.0);
                let mut admittance =
                    self.wall_admittance * ((2.0 * dx) / depth + walls as f64) + port;
                if c == 0 {
                    admittance += self.glottis_admittance;
                }
                let half = (COURANT * admittance) / 2.0;
                self.keep[i] = (1.0 - half) / (1.0 + half);
                self.gain[i] = COURANT / (depth * (1.0 + half));
            }
        }
        for r in 0..rows {
            if h[(columns - 1) * rows + r] <= 0.0 {
                self.lip_flow[r] = 0.0;
                self.lip_current[r] = 0.0;
            }
        }
        self.ports[0].line.configure(1.0 / step_time);
    }
    fn column_mean(&self, column: usize) -> f64 {
        let mut sum = 0.0;
        let mut weight = 0.0;
        for i in column * self.sheet.rows..(column + 1) * self.sheet.rows {
            sum += self.sheet.h[i] * self.pressure[i];
            weight += self.sheet.h[i];
        }
        if weight > 0.0 {
            sum / weight
        } else {
            0.0
        }
    }
    fn drive_column(&mut self, column: usize, amount: f64) {
        for i in column * self.sheet.rows..(column + 1) * self.sheet.rows {
            self.divergence[i] += self.sheet.h[i] * amount;
        }
    }
    fn step_faces(&mut self) {
        let (columns, rows) = (self.sheet.columns, self.sheet.rows);
        for face in 0..self.depth_x.len() {
            let depth = self.depth_x[face];
            if depth == 0.0 {
                continue;
            }
            let b = face + rows;
            let u = self.damping_x[face]
                * (self.velocity_x[face] - COURANT * (self.pressure[b] - self.pressure[face]));
            self.velocity_x[face] = u;
            self.divergence[face] += depth * u;
            self.divergence[b] -= depth * u;
        }
        for c in 0..columns {
            for r in 0..rows - 1 {
                let face = c * (rows - 1) + r;
                let depth = self.depth_y[face];
                if depth == 0.0 {
                    continue;
                }
                let a = c * rows + r;
                let u = self.damping_y[face]
                    * (self.velocity_y[face] - COURANT * (self.pressure[a + 1] - self.pressure[a]));
                self.velocity_y[face] = u;
                self.divergence[a] += depth * u;
                self.divergence[a + 1] -= depth * u;
            }
        }
    }
    fn step_lips(&mut self) -> f64 {
        let rows = self.sheet.rows;
        let last = (self.sheet.columns - 1) * rows;
        let r = RADIATION_RESISTANCE;
        let share = 1.0 / (1.0 + (r * self.lip_step) / 2.0);
        let mut output = 0.0;
        for row in 0..rows {
            let depth = self.sheet.h[last + row];
            if depth <= 0.0 {
                continue;
            }
            let flow = self.lip_flow[row];
            let current = self.lip_current[row];
            let a = (self.half_step * share * r) / 2.0;
            let next = (flow * (1.0 - a)
                + self.half_step * (self.pressure[last + row] + share * r * current))
                / (1.0 + a);
            let face = share * r * ((flow + next) / 2.0 - current);
            self.lip_current[row] = current + self.lip_step * face;
            self.lip_flow[row] = next;
            self.divergence[last + row] += depth * next;
            output += depth * next;
        }
        output
    }
}
impl Solver for Fdtd2d {
    fn set_shape(&mut self, values: &[f64]) {
        let areas = frame::areas(values);
        self.sheet.update(
            areas,
            values[frame::VELUM_INDEX],
            values[frame::LATERAL],
            values[frame::FRICATION_INDEX],
        );
        self.ports[0]
            .line
            .set_port(max(0.0, values[frame::VELUM_AREA]));
        self.ports[0].column = self.sheet.velum_column;
        self.area_count = areas.len();
        self.length = values[frame::LENGTH];
        self.dirty = true;
    }
    fn step_duration(&self) -> f64 {
        (self.dt * self.length) / (self.sheet.columns as f64 * self.sheet.dx)
    }
    fn glottal_load(&self) -> (f64, f64) {
        (
            (self.column_mean(0) - self.source_gain * self.last_flow) / 2.0,
            if self.source_gain > 0.0 {
                1.0 / self.source_gain
            } else {
                f64::INFINITY
            },
        )
    }
    fn set_glottal_reflection(&mut self, reflection: f64) {
        self.glottis_admittance = (1.0 - reflection) / (1.0 + reflection);
        self.dirty = true;
    }
    fn step(&mut self, flow: f64, noise_at: f64, noise: f64, transient: f64) -> f64 {
        if self.dirty {
            self.update();
        }
        let rows = self.sheet.rows;
        self.burst_state = transient - self.burst_input + self.burst_leak * self.burst_state;
        self.burst_input = transient;
        let jump = noise + self.burst_state;
        if jump != 0.0 {
            let column = (math::round_half_up(
                (noise_at / self.area_count as f64) * self.sheet.columns as f64,
            ) as usize)
                .clamp(1, self.sheet.columns - 1)
                - 1;
            let force = COURANT * jump;
            for face in column * rows..(column + 1) * rows {
                if self.depth_x[face] > 0.0 {
                    self.velocity_x[face] += force;
                }
            }
        }
        self.step_faces();
        self.drive_column(0, -flow / max(self.sheet.areas[0], 1e-4));
        self.last_flow = flow;
        let mut sum = 0.0;
        let mut weight = 0.0;
        for i in 0..rows {
            sum += self.sheet.h[i] * self.sheet.h[i] * self.gain[i];
            weight += self.sheet.h[i];
        }
        self.source_gain = if weight > 0.0 {
            sum / (weight * max(self.sheet.areas[0], 1e-4))
        } else {
            0.0
        };
        for p in 0..self.ports.len() {
            let column = self.ports[p].column;
            let left = self.ports[p].line.left[0];
            self.ports[p].left = left;
            if self.ports[p].line.open() {
                self.ports[p].mean = self.column_mean(column);
                let share = self.ports[p].line.port_area / max(self.sheet.areas[column], 1e-4);
                self.drive_column(column, -2.0 * share * left);
            }
        }
        let output = self.step_lips() * self.sheet.dx;
        for i in 0..self.pressure.len() {
            self.pressure[i] = self.keep[i] * self.pressure[i] - self.gain[i] * self.divergence[i];
            self.divergence[i] = 0.0;
        }
        for p in 0..self.ports.len() {
            let port = &self.ports[p];
            let outgoing = if port.line.open() {
                (port.mean + self.column_mean(port.column)) / 2.0 - port.left
            } else {
                port.left
            };
            self.ports[p].line.step(outgoing);
        }
        output + self.ports[0].line.output
    }
    fn field(&self, out: &mut [f64]) -> usize {
        let columns = self.sheet.columns.min(out.len());
        for (c, value) in out[..columns].iter_mut().enumerate() {
            *value = self.column_mean(c);
        }
        let used = columns + self.ports[0].line.field(&mut out[columns..]);
        let cells = self.pressure.len().min(out.len() - used);
        out[used..used + cells].copy_from_slice(&self.pressure[..cells]);
        used + cells
    }
}
