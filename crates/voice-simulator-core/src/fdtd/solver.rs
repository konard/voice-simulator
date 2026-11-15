//! The 3D FDTD solver: a port of `Fdtd3d` (`src/acoustics/fdtd3d.js`),
//! method by method and in the same order of operations, without the GPU
//! path. The step loop is the gather form of [`Grid`] (bit-identical with
//! the JavaScript loop); the coefficients go through `pow`, `exp` and
//! `sqrt` of [`crate::math`], so the solver is parity class B
//! (docs/RUST-ENGINE.md).
//!
//! The JavaScript constructor takes the head and the listening options;
//! here [`FdtdOptions`] carries what it derives from them, which
//! `fdtdListening` of `src/engine/pack-model.js` computes.

use alloc::collections::BTreeMap;
use alloc::vec;
use alloc::vec::Vec;

use super::kernel::{Grid, COURANT};
use super::model::{
    Model, CELL_AIR, CELL_NOSE, CELL_SINUS, CELL_TRACT, LINK_INNER, LINK_LIPS, LINK_NOSTRILS,
    LINK_RADIATION, LINK_SINUS, LINK_VELUM,
};
use crate::frame;
use crate::glottis::{glottal_reflection, SPEED_OF_SOUND};
use crate::losses::{boundary_loss_factor, LOSS_REFERENCE_SECTIONS};
use crate::math::{self, abs, floor, js_hypot, max, min};
use crate::solver::Solver;

/// Smallest fill of a tube cell.
pub const MIN_FILL: f64 = 1e-4;
/// Microphone level per cm of cell size.
pub const MICROPHONE_GAIN: f64 = 3.9;
/// Time constant of the leaky source integrator in microphone mode (s).
pub const MICROPHONE_LEAK_TIME: f64 = 0.008;
/// Gain of the turbulence source.
pub const NOISE_GAIN: f64 = 1.5;
/// Extra microphone level with the spherical boundary or an enclosure.
pub const SPHERICAL_MICROPHONE_GAIN: f64 = 4.2;
/// Section count of the noise position before the first shape.
const DEFAULT_SECTIONS: f64 = 44.0;

/// `OPEN_FACE_NORMALS` of voxel-model.js, by bit of the open mask (the
/// signs of the zeros as JavaScript computes them).
const OPEN_FACE_NORMALS: [[f64; 3]; 6] = [
    [1.0, 0.0, 0.0],
    [-1.0, -0.0, -0.0],
    [0.0, 1.0, 0.0],
    [-0.0, -1.0, -0.0],
    [0.0, 0.0, 1.0],
    [-0.0, -0.0, -1.0],
];

/// What the solver reads from the radiated field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Output {
    /// Volume flow out of the lips and nostrils.
    Flow,
    /// Pressure at the receiver cell.
    Microphone,
}

/// What `Fdtd3d` derives from the head and the listening options.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FdtdOptions {
    /// Output of [`Solver::step`].
    pub output: Output,
    /// Give the free-air shell the spherical-wave boundary (a microphone
    /// without an enclosure).
    pub spherical: bool,
    /// Point the receiver cell is the closest free-air cell to (cm).
    pub target: [f64; 3],
    /// `head.wallLoss`.
    pub wall_loss: f64,
    /// `head.nasalLoss`.
    pub nasal_loss: f64,
    /// `head.glottalChink` (mm²).
    pub glottal_chink: f64,
    /// `head.vocalTractLength` (cm).
    pub vocal_tract_length: f64,
}

/// Section span of every tube link for the area counts `counts`.
#[derive(Clone, Debug, PartialEq)]
struct Spans {
    counts: [usize; 2],
    from: Vec<i64>,
    to: Vec<i64>,
}

/// The grid arrays of the model: with the spherical boundary, one more
/// (ghost) cell and one radiation link per boundary cell.
struct GridModel {
    kind: Vec<u8>,
    tube: Vec<i32>,
    arc: Vec<f64>,
    link_a: Vec<u32>,
    link_b: Vec<u32>,
    link_kind: Vec<u8>,
    open_faces: Vec<f64>,
}

/// The spherical-wave boundary (`withSphericalBoundary`): the grid, the
/// first radiation link, the ghost cell and the radiation conductances.
fn with_spherical_boundary(model: &Model) -> (GridModel, usize, usize, Vec<f64>) {
    let dx = model.dx;
    let mut boundary = Vec::new();
    let mut conductance = Vec::new();
    let mut admittance = model.open_faces.clone();
    for index in 0..model.cells() {
        if model.kind[index] != CELL_AIR || model.open_faces[index] == 0.0 {
            continue;
        }
        let point = model.point[index];
        let offsets = [model.lips, model.nostrils]
            .map(|centre| [0, 1, 2].map(|axis| point[axis] - centre[axis]));
        let distances = offsets.map(|offset| js_hypot(&offset));
        let nearest = if distances[0] <= distances[1] { 0 } else { 1 };
        let radius = max(dx, distances[nearest]);
        let offset = offsets[nearest];
        let mut weight = 0.0;
        for (bit, normal) in OPEN_FACE_NORMALS.iter().enumerate() {
            if model.open_masks[index] & (1 << bit) != 0 {
                let cosine =
                    (normal[0] * offset[0] + normal[1] * offset[1] + normal[2] * offset[2])
                        / radius;
                weight += max(0.0, cosine);
            }
        }
        admittance[index] = weight;
        boundary.push(index as u32);
        conductance.push((weight * dx) / (radius + dx / 2.0));
    }
    let first = model.links();
    let ghost = model.cells();
    let mut grid = GridModel {
        kind: model.kind.clone(),
        tube: model.tube.clone(),
        arc: model.arc.clone(),
        link_a: model.link_a.clone(),
        link_b: model.link_b.clone(),
        link_kind: model.link_kind.clone(),
        open_faces: admittance,
    };
    grid.kind.push(CELL_AIR);
    grid.tube.push(-1);
    grid.arc.push(0.0);
    grid.open_faces.push(0.0);
    grid.link_b.resize(first + boundary.len(), ghost as u32);
    grid.link_kind
        .resize(first + boundary.len(), LINK_RADIATION);
    grid.link_a.extend(boundary);
    (grid, first, ghost, conductance)
}

/// `resample` of fdtd3d.js: linear interpolation of section values at a
/// relative position, sections centred.
fn resample(values: &[f64], position: f64) -> f64 {
    let length = values.len() as f64;
    let source = max(0.0, min(length - 1.0, position * length - 0.5));
    let lower = floor(source);
    let upper = min(length - 1.0, lower + 1.0);
    let low = values[lower as usize];
    low + (values[upper as usize] - low) * (source - lower)
}

/// Cells of every tube (tract, nose, pouches) sorted by arc
/// (`tubeMembers`; the sort is stable, as `Array.prototype.sort`).
fn tube_members(grid: &GridModel) -> Vec<Vec<usize>> {
    let mut tubes: BTreeMap<i32, Vec<usize>> = BTreeMap::new();
    for (index, &kind) in grid.kind.iter().enumerate() {
        if kind != CELL_AIR {
            tubes.entry(grid.tube[index]).or_default().push(index);
        }
    }
    tubes
        .into_values()
        .map(|mut members| {
            // `(a, b) => arc[a] - arc[b]`: -0 and 0 are equal there.
            members.sort_by(|&a, &b| {
                grid.arc[a]
                    .partial_cmp(&grid.arc[b])
                    .unwrap_or(core::cmp::Ordering::Equal)
            });
            members
        })
        .collect()
}

/// `envelopeAreas`: cross-section of the envelope at each tube cell.
fn envelope_areas(grid: &GridModel, dx: f64) -> Vec<f64> {
    let arc = &grid.arc;
    let mut areas = vec![dx * dx; grid.kind.len()];
    let reach = 2.0 * dx;
    for sorted in tube_members(grid) {
        for &index in &sorted {
            areas[index] = 0.0;
        }
        let mut low = 0;
        for &index in &sorted {
            let here = arc[index];
            while arc[sorted[low]] < here - reach {
                low += 1;
            }
            for &other in &sorted[low..] {
                if arc[other] > here + reach {
                    break;
                }
                let weight = 1.0 - abs(arc[other] - here) / reach;
                areas[index] += (weight * dx * dx) / 2.0;
            }
        }
    }
    areas
}

/// Index of the free-air cell of `model` closest to `point`
/// (`nearestAirCell`); the first one on a tie.
pub fn nearest_air_cell(model: &Model, point: [f64; 3]) -> Option<usize> {
    let mut best = None;
    let mut best_distance = f64::INFINITY;
    for (index, cell) in model.point.iter().enumerate() {
        if model.kind[index] != CELL_AIR {
            continue;
        }
        let distance = js_hypot(&[0, 1, 2].map(|axis| cell[axis] - point[axis]));
        if distance < best_distance {
            best_distance = distance;
            best = Some(index);
        }
    }
    best
}

/// The 3D FDTD solver (`Fdtd3d`).
#[derive(Clone, Debug)]
pub struct Fdtd3d {
    model: Model,
    grid: Grid,
    dx: f64,
    dt: f64,
    output: Output,
    wall_loss: f64,
    nasal_loss: f64,
    glottis_admittance: f64,
    cell_kind: Vec<u8>,
    cell_arc: Vec<f64>,
    fill: Vec<f64>,
    cell_area: Vec<f64>,
    envelope: Vec<f64>,
    effective: Vec<f64>,
    teeth_cell: Vec<bool>,
    openness: Vec<f64>,
    solid: Vec<bool>,
    teeth_gap: Option<f64>,
    link_kind: Vec<u8>,
    tube_links: Vec<usize>,
    tube_cells: [Vec<usize>; 2],
    spans: Option<Spans>,
    output_links: Vec<usize>,
    output_signs: Vec<f64>,
    velum_links: Vec<usize>,
    source_cells: Vec<usize>,
    opening_floors: Vec<(usize, f64)>,
    admittance: Vec<f64>,
    microphone: usize,
    microphone_gain: f64,
    noise_arc: f64,
    noise_links: Vec<usize>,
    noise_signs: Vec<f64>,
    velum_area: f64,
    source_state: f64,
    noise_state: f64,
    burst_input: f64,
    burst_state: f64,
    leak: f64,
    tube_areas: [Option<Vec<f64>>; 2],
    area_count: Option<usize>,
    length: f64,
}

impl Fdtd3d {
    /// The solver of a model (the constructor of `Fdtd3d`). `None` when
    /// the model has no free-air cell for the receiver.
    pub fn new(model: Model, options: &FdtdOptions) -> Option<Self> {
        let dx = model.dx;
        let dt = (COURANT * dx) / SPEED_OF_SOUND;
        let reflection = glottal_reflection(options.glottal_chink, options.vocal_tract_length);
        let microphone = nearest_air_cell(&model, options.target)?;
        let spherical = options.spherical && !model.enclosure;
        let (grid_model, radiation) = if spherical {
            let (grid, first, ghost, conductance) = with_spherical_boundary(&model);
            (grid, Some((first, ghost, conductance)))
        } else {
            let grid = GridModel {
                kind: model.kind.clone(),
                tube: model.tube.clone(),
                arc: model.arc.clone(),
                link_a: model.link_a.clone(),
                link_b: model.link_b.clone(),
                link_kind: model.link_kind.clone(),
                open_faces: model.open_faces.clone(),
            };
            (grid, None)
        };
        let cell_count = grid_model.kind.len();
        let link_count = grid_model.link_a.len();
        let mut grid = Grid::new(link_count, cell_count);
        grid.link_a.clone_from(&grid_model.link_a);
        grid.link_b.clone_from(&grid_model.link_b);
        if !grid.index() {
            return None;
        }
        let envelope = envelope_areas(&grid_model, dx);
        let mut teeth_cell = vec![false; cell_count];
        if let Some(teeth) = &model.teeth {
            for &cell in &teeth.cells {
                teeth_cell[cell] = true;
            }
        }
        let mut solver = Self {
            dx,
            dt,
            output: options.output,
            wall_loss: options.wall_loss,
            nasal_loss: options.nasal_loss,
            glottis_admittance: (1.0 - reflection) / (1.0 + reflection),
            fill: vec![1.0; cell_count],
            cell_area: vec![0.0; cell_count],
            effective: envelope.clone(),
            envelope,
            teeth_cell,
            openness: vec![1.0; cell_count],
            solid: vec![false; cell_count],
            teeth_gap: None,
            link_kind: grid_model.link_kind.clone(),
            tube_links: Vec::new(),
            tube_cells: [Vec::new(), Vec::new()],
            spans: None,
            output_links: Vec::new(),
            output_signs: Vec::new(),
            velum_links: Vec::new(),
            source_cells: Vec::new(),
            opening_floors: Vec::new(),
            admittance: vec![0.0; cell_count],
            microphone,
            microphone_gain: 1.0,
            noise_arc: -1.0,
            noise_links: Vec::new(),
            noise_signs: Vec::new(),
            velum_area: 0.0,
            source_state: 0.0,
            noise_state: 0.0,
            burst_input: 0.0,
            burst_state: 0.0,
            leak: 1.0 - dt / MICROPHONE_LEAK_TIME,
            tube_areas: [None, None],
            area_count: None,
            length: 0.0,
            cell_kind: grid_model.kind.clone(),
            cell_arc: grid_model.arc.clone(),
            grid,
            model,
        };
        solver.allocate();
        solver.prepare_boundaries(&grid_model);
        if let Some((first, ghost, conductance)) = radiation {
            solver.microphone_gain = SPHERICAL_MICROPHONE_GAIN;
            solver.grid.conductance[first..first + conductance.len()].copy_from_slice(&conductance);
            solver.grid.keep[ghost] = 0.0;
            solver.grid.gain[ghost] = 0.0;
        } else if solver.model.enclosure {
            solver.microphone_gain = SPHERICAL_MICROPHONE_GAIN;
        }
        Some(solver)
    }

    /// The model.
    pub fn model(&self) -> &Model {
        &self.model
    }

    /// The step loop arrays.
    pub fn grid(&self) -> &Grid {
        &self.grid
    }

    /// The receiver cell.
    pub fn microphone(&self) -> usize {
        self.microphone
    }

    /// Time step of the rest tract (s).
    pub fn dt(&self) -> f64 {
        self.dt
    }

    /// The rest of `#allocate` after the arrays: link and cell lists, the
    /// source cells and the sinus fills.
    fn allocate(&mut self) {
        self.index_links();
        for link in 0..self.link_kind.len() {
            let kind = self.link_kind[link];
            if kind == LINK_LIPS || kind == LINK_NOSTRILS {
                self.output_links.push(link);
            } else if kind == LINK_VELUM {
                self.velum_links.push(link);
            }
        }
        self.output_signs = self
            .output_links
            .iter()
            .map(|&link| {
                if self.cell_kind[self.grid.link_a[link] as usize] == CELL_AIR {
                    -1.0
                } else {
                    1.0
                }
            })
            .collect();
        for index in 0..self.model.cells() {
            if self.model.kind[index] == CELL_TRACT && self.model.arc[index] <= 0.75 * self.dx {
                self.source_cells.push(index);
            }
        }
        self.fill_sinuses();
    }

    /// `#fillSinuses`.
    fn fill_sinuses(&mut self) {
        let cubic = math::pow(self.dx, 3.0);
        for sinus in &self.model.sinuses {
            let cells: Vec<usize> = (0..self.model.cells())
                .filter(|&index| {
                    self.model.kind[index] == CELL_SINUS && self.model.tube[index] == sinus.tube
                })
                .collect();
            let fill = min(
                1.0,
                max(
                    MIN_FILL,
                    (sinus.area * sinus.length) / (cells.len() as f64 * cubic),
                ),
            );
            for index in cells {
                self.fill[index] = fill;
            }
        }
        let mut floors: Vec<(usize, f64)> = Vec::new();
        for link in 0..self.link_kind.len() {
            if self.link_kind[link] != LINK_SINUS {
                continue;
            }
            let a = self.grid.link_a[link] as usize;
            let b = self.grid.link_b[link] as usize;
            let (tract, sinus) = if self.cell_kind[a] == CELL_SINUS {
                (b, a)
            } else {
                (a, b)
            };
            let fill = self.fill[sinus];
            match floors.iter_mut().find(|(cell, _)| *cell == tract) {
                Some(entry) => entry.1 = max(entry.1, fill),
                None => floors.push((tract, max(0.0, fill))),
            }
        }
        self.opening_floors = floors;
    }

    /// `#ranked`.
    fn ranked(&self, index: usize) -> bool {
        self.model.opening.is_some()
            && self.teeth_gap.is_some()
            && self.cell_kind[index] == CELL_TRACT
            && !self.teeth_cell[index]
    }

    /// `#narrowedFill`.
    fn narrowed_fill(&self, index: usize, narrowest: f64) -> f64 {
        if self.ranked(index) {
            return self.fill[index] * min(1.0, narrowest / max(self.cell_area[index], 1e-12));
        }
        self.fill_at(index, narrowest)
    }

    /// `#binScale`.
    fn bin_scale(&self, bin: usize, area: f64) -> f64 {
        let Some(opening) = &self.model.opening else {
            return 0.0;
        };
        let start = opening.starts[bin];
        let count = opening.starts[bin + 1] - start;
        let weights = &opening.weights[start..start + count];
        let shares = &opening.shares[start..start + count];
        let heads = &opening.heads[start + bin..start + bin + count + 1];
        let tails = &opening.tails[start + bin..start + bin + count + 1];
        let target = area / opening.sample;
        if count == 0 {
            return 0.0;
        }
        if target >= heads[count] {
            return f64::INFINITY;
        }
        let mut low: i64 = -1;
        let mut high: i64 = count as i64 - 1;
        while low < high {
            let middle = (low + high + 1) >> 1;
            let m = middle as usize;
            let filled = heads[m] + shares[m] + tails[m + 1] / weights[m];
            if filled <= target {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        let next = (low + 1) as usize;
        (target - heads[next]) / tails[next]
    }

    /// `#scale`.
    fn scale(&self, arc: f64, area: f64) -> f64 {
        let Some(opening) = &self.model.opening else {
            return 0.0;
        };
        let last = (opening.bins() - 1) as f64;
        let at = min(last, max(0.0, arc / opening.bin_length - 0.5));
        let lower = floor(at);
        let upper = min(last, lower + 1.0);
        let low = self.bin_scale(lower as usize, area);
        let high = self.bin_scale(upper as usize, area);
        if !low.is_finite() || !high.is_finite() || low <= 0.0 {
            return max(low, high);
        }
        low * math::pow(high / low, at - lower)
    }

    /// `#openShare`.
    fn open_share(&self, index: usize, scale: f64) -> f64 {
        let Some(opening) = &self.model.opening else {
            return 0.0;
        };
        if scale == f64::INFINITY {
            return 1.0;
        }
        let per = opening.per;
        let row = opening.rows[index].unwrap_or(0);
        let weights = &opening.cell_weights[row * per..(row + 1) * per];
        let mut low = 0;
        let mut high = per;
        while low < high {
            let middle = (low + high) >> 1;
            if scale * weights[middle] >= 1.0 {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        (low as f64 + scale * opening.cell_tails[row * (per + 1) + low]) / per as f64
    }

    /// `#fillAt`.
    fn fill_at(&self, index: usize, area: f64) -> f64 {
        if self.ranked(index) {
            return self.open_share(index, self.scale(self.cell_arc[index], area));
        }
        self.openness[index] * min(1.0, max(0.0, area / self.effective[index]))
    }

    /// `#indexLinks`.
    fn index_links(&mut self) {
        self.tube_links = (0..self.link_kind.len())
            .filter(|&link| {
                let a = self.cell_kind[self.grid.link_a[link] as usize];
                let b = self.cell_kind[self.grid.link_b[link] as usize];
                a != CELL_AIR || b != CELL_AIR
            })
            .collect();
        self.tube_cells = [CELL_TRACT, CELL_NOSE].map(|kind| {
            (0..self.cell_kind.len())
                .filter(|&index| self.cell_kind[index] == kind)
                .collect()
        });
        self.spans = None;
    }

    /// `#prepareBoundaries`.
    fn prepare_boundaries(&mut self, grid: &GridModel) {
        let wall = self.model.boundary_admittance;
        for (index, faces) in grid.open_faces.iter().enumerate() {
            self.admittance[index] = faces * wall;
        }
        let mut slices = 0.0;
        for &index in &self.source_cells {
            slices += (self.dx * self.dx) / self.envelope[index];
        }
        for &index in &self.source_cells {
            self.admittance[index] = self.glottis_admittance / max(1.0, slices);
        }
        for index in 0..self.cell_kind.len() {
            self.update_cell(index);
        }
    }

    /// One cell of `#updateCellCoefficients`.
    fn update_cell(&mut self, index: usize) {
        let half = (COURANT * self.admittance[index]) / 2.0;
        self.grid.keep[index] = (1.0 - half) / (1.0 + half);
        self.grid.gain[index] = COURANT / (self.fill[index] * (1.0 + half));
    }

    fn update_tube_cells(&mut self, kind: usize) {
        for position in 0..self.tube_cells[kind].len() {
            let index = self.tube_cells[kind][position];
            self.update_cell(index);
        }
    }

    /// `#setTube`: false when the areas did not change.
    fn set_tube(&mut self, kind: usize, areas: &[f64], force: bool) -> bool {
        if !force && self.tube_areas[kind].as_deref() == Some(areas) {
            return false;
        }
        self.tube_areas[kind] = Some(areas.to_vec());
        let length = self.model.lengths[kind];
        for position in 0..self.tube_cells[kind].len() {
            let index = self.tube_cells[kind][position];
            let area = resample(areas, self.cell_arc[index] / length);
            self.cell_area[index] = area;
            self.fill[index] = max(MIN_FILL, self.fill_at(index, area));
            if self.solid[index] {
                self.fill[index] = 1.0;
            }
        }
        if kind == CELL_TRACT as usize {
            for &(index, floor) in &self.opening_floors {
                self.fill[index] = max(self.fill[index], floor);
            }
        }
        true
    }

    /// `#applyTeeth`: false when the gap did not change.
    fn apply_teeth(&mut self, teeth: Option<f64>) -> bool {
        let gap = if self.model.teeth.is_some() {
            teeth
        } else {
            None
        };
        if gap == self.teeth_gap {
            return false;
        }
        self.teeth_gap = gap;
        let Some(open) = self.teeth_slot(gap) else {
            return true;
        };
        let Some(teeth) = &self.model.teeth else {
            return true;
        };
        let mut groups: BTreeMap<i32, (f64, f64)> = BTreeMap::new();
        for (position, &group) in teeth.groups.iter().enumerate() {
            let entry = groups.entry(group).or_insert((0.0, 0.0));
            entry.0 += 1.0;
            entry.1 += open[position];
        }
        for (position, &cell) in teeth.cells.iter().enumerate() {
            let (total, opened) = groups[&teeth.groups[position]];
            let share = opened / total;
            let solid = gap.is_some() && open[position] == 0.0;
            if solid && !self.solid[cell] {
                self.grid.pressure[cell] = 0.0;
            }
            self.solid[cell] = solid;
            self.openness[cell] = if gap.is_none() { 1.0 } else { open[position] };
            self.effective[cell] = self.envelope[cell] * if gap.is_none() { 1.0 } else { share };
        }
        true
    }

    /// `#teethSlot`: the open share of every teeth cell, `None` without
    /// teeth. JavaScript runs it with a null gap too, where `edge - null`
    /// is `edge`; the shares are unused then (every cell opens fully).
    fn teeth_slot(&self, gap: Option<f64>) -> Option<Vec<f64>> {
        let teeth = self.model.teeth.as_ref()?;
        let gap = gap.unwrap_or(0.0);
        let (edge, width) = (teeth.edge, teeth.width);
        let dx = self.dx;
        let half = dx / 2.0;
        let overlap = |low: f64, high: f64| min(1.0, max(0.0, high - low) / dx);
        let mut open = vec![0.0; teeth.cells.len()];
        let mut nearest: BTreeMap<i32, (f64, usize)> = BTreeMap::new();
        for (position, &cell) in teeth.cells.iter().enumerate() {
            let [x, y, _] = self.model.point[cell];
            open[position] = overlap(max(y - half, edge - gap), min(y + half, edge))
                * overlap(max(x - half, -width / 2.0), min(x + half, width / 2.0));
            let vertical = max(y - half - edge, edge - gap - (y + half));
            let lateral = abs(x) - half - width / 2.0;
            let distance = max(vertical, 0.0) + max(lateral, 0.0);
            let group = teeth.groups[position];
            let better = match nearest.get(&group) {
                Some(&(best, _)) => distance < best,
                None => true,
            };
            if better {
                nearest.insert(group, (distance, position));
            }
        }
        for &(_, position) in nearest.values() {
            if open[position] == 0.0 {
                open[position] = 1.0;
            }
        }
        Some(open)
    }

    /// `#linkSpans`: the cached spans for the current area counts.
    fn link_spans(&mut self) {
        let counts = [0, 1].map(|kind| self.tube_areas[kind].as_ref().map_or(0, Vec::len));
        if self
            .spans
            .as_ref()
            .is_some_and(|spans| spans.counts == counts)
        {
            return;
        }
        let links = self.link_kind.len();
        let mut from = vec![-1_i64; links];
        let mut to = vec![-1_i64; links];
        for &link in &self.tube_links {
            let a = self.grid.link_a[link] as usize;
            let b = self.grid.link_b[link] as usize;
            let kind = self.cell_kind[a] as usize;
            let count = if kind < 2 { counts[kind] } else { 0 };
            if self.link_kind[link] != LINK_INNER || count == 0 {
                continue;
            }
            let scale = count as f64 / self.model.lengths[kind];
            let last = (count - 1) as f64;
            let arc_a = self.cell_arc[a];
            let arc_b = self.cell_arc[b];
            from[link] = min(last, floor(min(arc_a, arc_b) * scale)) as i64;
            to[link] = min(last, floor(max(arc_a, arc_b) * scale)) as i64;
        }
        self.spans = Some(Spans { counts, from, to });
    }

    /// `#updateLinks`.
    fn update_links(&mut self) {
        let exponent = (SPEED_OF_SOUND * self.dt * LOSS_REFERENCE_SECTIONS) / self.model.lengths[0];
        self.link_spans();
        let spans = self.spans.take().unwrap_or(Spans {
            counts: [0, 0],
            from: Vec::new(),
            to: Vec::new(),
        });
        for position in 0..self.tube_links.len() {
            let link = self.tube_links[position];
            let a = self.grid.link_a[link] as usize;
            let b = self.grid.link_b[link] as usize;
            if self.solid[a] || self.solid[b] {
                self.grid.conductance[link] = 0.0;
                self.grid.damping[link] = 0.0;
                self.grid.velocity[link] = 0.0;
                continue;
            }
            let mut fill_a = self.fill[a];
            let mut fill_b = self.fill[b];
            let mut area = min(fill_a * self.effective[a], fill_b * self.effective[b]);
            if spans.from[link] >= 0 {
                let kind = self.cell_kind[a] as usize;
                let narrowest = match &self.tube_areas[kind] {
                    Some(areas) => {
                        let (from, to) = (spans.from[link] as usize, spans.to[link] as usize);
                        let mut inverse = 0.0;
                        for &section in &areas[from..=to] {
                            inverse += 1.0 / max(section, 1e-12);
                        }
                        (to - from + 1) as f64 / inverse
                    }
                    None => f64::INFINITY,
                };
                fill_a = min(fill_a, self.narrowed_fill(a, narrowest));
                fill_b = min(fill_b, self.narrowed_fill(b, narrowest));
                area = min(area, narrowest);
            }
            let kind = self.link_kind[link];
            self.grid.conductance[link] = if kind == LINK_LIPS || kind == LINK_NOSTRILS {
                max(0.0, min(fill_a, fill_b))
            } else {
                max(0.0, (2.0 * fill_a * fill_b) / max(fill_a + fill_b, 1e-12))
            };
            let nasal = self.cell_kind[a] == CELL_NOSE || self.cell_kind[b] == CELL_NOSE;
            let wall_loss = if nasal {
                self.wall_loss * self.nasal_loss
            } else {
                self.wall_loss
            };
            self.grid.damping[link] =
                math::pow(max(0.0, boundary_loss_factor(area, wall_loss)), exponent);
        }
        self.spans = Some(spans);
        self.scale_openings();
        let port_area = self.velum_links.len() as f64 * self.dx * self.dx;
        let open = min(1.0, self.velum_area / max(port_area, 1e-9));
        for &link in &self.velum_links {
            self.grid.conductance[link] = min(self.grid.conductance[link], open);
            if open <= MIN_FILL {
                self.grid.conductance[link] = 0.0;
                self.grid.velocity[link] = 0.0;
            }
        }
    }

    /// `#scaleOpenings`.
    fn scale_openings(&mut self) {
        let dx = self.dx;
        let mut totals = [0.0, 0.0];
        for &link in &self.output_links {
            let tube = usize::from(self.link_kind[link] != LINK_LIPS);
            totals[tube] += self.grid.conductance[link] * dx * dx;
        }
        let scales = [0, 1].map(|tube| {
            let area = self.tube_areas[tube]
                .as_ref()
                .and_then(|areas| areas.last().copied())
                .unwrap_or(0.0);
            area / max(totals[tube], 1e-12)
        });
        for &link in &self.output_links {
            let scale = scales[usize::from(self.link_kind[link] != LINK_LIPS)];
            self.grid.conductance[link] = min(1.0, self.grid.conductance[link] * scale);
        }
    }

    /// Nasal tract cross-sections (`setNose`).
    pub fn set_nose(&mut self, areas: &[f64]) {
        if areas.is_empty() {
            return;
        }
        if self.set_tube(1, areas, false) {
            self.update_links();
            self.update_tube_cells(1);
        }
    }

    /// Oral tract areas, velopharyngeal port and incisor gap (`setShape`).
    pub fn set_areas(&mut self, areas: &[f64], velum_area: f64, teeth: Option<f64>) {
        if areas.is_empty() {
            return;
        }
        let velum = max(0.0, velum_area);
        let moved = self.apply_teeth(teeth);
        let changed = self.set_tube(0, areas, moved) || moved;
        if !changed && velum == self.velum_area {
            return;
        }
        self.velum_area = velum;
        self.update_links();
        self.update_tube_cells(0);
        self.area_count = Some(areas.len());
    }

    /// `#selectNoiseLinks`.
    fn select_noise_links(&mut self, arc: f64) {
        if abs(arc - self.noise_arc) < 1e-6 {
            return;
        }
        self.noise_arc = arc;
        self.noise_links.clear();
        self.noise_signs.clear();
        for link in 0..self.link_kind.len() {
            if self.link_kind[link] != LINK_INNER {
                continue;
            }
            let a = self.grid.link_a[link] as usize;
            let b = self.grid.link_b[link] as usize;
            if self.cell_kind[a] != CELL_TRACT || self.cell_kind[b] != CELL_TRACT {
                continue;
            }
            let arc_a = self.cell_arc[a];
            let arc_b = self.cell_arc[b];
            if min(arc_a, arc_b) < arc && max(arc_a, arc_b) >= arc {
                self.noise_links.push(link);
                self.noise_signs.push(js_sign(arc_b - arc_a));
            }
        }
    }

    /// `#noiseForce`.
    fn noise_force(&mut self, position: f64, noise: f64) -> f64 {
        let mut force = noise;
        if self.output == Output::Microphone {
            self.noise_state = self.noise_state * self.leak + noise;
            force = self.noise_state * self.dx * MICROPHONE_GAIN;
        }
        if force == 0.0 {
            return 0.0;
        }
        let sections = self
            .area_count
            .map_or(DEFAULT_SECTIONS, |count| count as f64);
        let arc = (position / sections) * self.model.lengths[0];
        self.select_noise_links(arc);
        COURANT * NOISE_GAIN * force
    }

    /// `#burst`.
    fn burst(&mut self, flow: f64) -> f64 {
        self.burst_state = flow - self.burst_input + self.leak * self.burst_state;
        self.burst_input = flow;
        self.burst_state
    }

    /// `#sourcePressure`.
    fn source_pressure(&mut self, glottal_flow: f64) -> f64 {
        let mut flow = glottal_flow;
        if self.output == Output::Microphone {
            self.source_state = self.source_state * self.leak + glottal_flow;
            flow = self.source_state * self.dx * MICROPHONE_GAIN;
        }
        let mut area = 0.0;
        for &index in &self.source_cells {
            area += self.fill[index] * self.dx * self.dx;
        }
        (COURANT * flow) / max(area, 1e-3)
    }

    /// `#measure`.
    fn measure(&self) -> f64 {
        if self.output == Output::Microphone {
            return self.grid.pressure[self.microphone] * self.microphone_gain;
        }
        let mut flow = 0.0;
        for (&link, &sign) in self.output_links.iter().zip(&self.output_signs) {
            flow += sign * self.grid.conductance[link] * self.grid.velocity[link];
        }
        flow * self.dx * self.dx
    }

    /// Step duration for a tract of `length` cm (`stepDuration`).
    pub fn step_duration_for(&self, length: f64) -> f64 {
        // NaN is not > 0, as in `!(length > 0)` of stepDuration.
        if length.partial_cmp(&0.0) != Some(core::cmp::Ordering::Greater) {
            return self.dt;
        }
        (self.dt * length) / self.model.lengths[0]
    }

    /// Forget the field and the source states (`reset`).
    pub fn reset(&mut self) {
        self.grid.pressure.fill(0.0);
        self.grid.velocity.fill(0.0);
        self.source_state = 0.0;
        self.noise_state = 0.0;
        self.burst_input = 0.0;
        self.burst_state = 0.0;
    }
}

/// `Math.sign`.
fn js_sign(value: f64) -> f64 {
    if value > 0.0 {
        1.0
    } else if value < 0.0 {
        -1.0
    } else {
        value
    }
}

impl Solver for Fdtd3d {
    fn set_shape(&mut self, frame: &[f64]) {
        self.length = frame[frame::LENGTH];
        self.set_areas(
            frame::areas(frame),
            frame[frame::VELUM_AREA],
            frame::teeth_gap(frame),
        );
    }

    fn step_duration(&self) -> f64 {
        self.step_duration_for(self.length)
    }

    fn step(&mut self, flow: f64, noise_at: f64, noise: f64, transient: f64) -> f64 {
        let burst = self.burst(transient);
        let force = self.noise_force(noise_at, noise + burst);
        if force != 0.0 {
            for (&link, &sign) in self.noise_links.iter().zip(&self.noise_signs) {
                self.grid.velocity[link] += force * sign;
            }
        }
        self.grid.step_gather();
        let pressure = self.source_pressure(flow);
        for &index in &self.source_cells {
            self.grid.pressure[index] += pressure * self.grid.keep[index];
        }
        self.measure()
    }

    /// The pressure of every cell of the model (not the ghost cell).
    fn field(&self, out: &mut [f64]) -> usize {
        let count = self.model.cells().min(out.len());
        out[..count].copy_from_slice(&self.grid.pressure[..count]);
        count
    }
}
