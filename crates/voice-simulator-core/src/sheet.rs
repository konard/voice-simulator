//! Dynamic elliptic sheet geometry (`acoustics/sheet-model.js`).
//! The host supplies the static anatomical widths; Rust updates every depth.
use crate::math::{self, max, min};
use alloc::{vec, vec::Vec};
use core::f64::consts::PI;

/// Fixed sheet grid with a changing area function.
#[derive(Clone, Debug)]
pub struct Sheet {
    /// Cell width in cm.
    pub dx: f64,
    /// Columns from glottis to lips.
    pub columns: usize,
    /// Rows across the tract.
    pub rows: usize,
    widths: Vec<f64>,
    /// Column-major cell depths.
    pub h: Vec<f64>,
    /// Cross-sectional areas per column.
    pub areas: Vec<f64>,
    /// Area at the lip face.
    pub lip_area: f64,
    /// Column containing the velum.
    pub velum_column: usize,
}
impl Sheet {
    /// Allocate the static grid packed by the host.
    pub fn new(dx: f64, rows: usize, widths: Vec<f64>) -> Self {
        let columns = widths.len();
        Self {
            dx,
            columns,
            rows,
            widths,
            h: vec![0.0; columns * rows],
            areas: vec![0.0; columns],
            lip_area: 0.0,
            velum_column: 0,
        }
    }
    fn column(&self, section: f64, sections: usize) -> usize {
        (math::floor(((section + 0.5) / sections.max(1) as f64) * self.columns as f64) as usize)
            .min(self.columns - 1)
    }
    /// Resample series inertance, fill elliptical cells and carve lateral channels.
    pub fn update(&mut self, areas: &[f64], velum: f64, lateral: f64, frication: f64) {
        let lateral = lateral.clamp(0.0, 1.0);
        let center = self.column(frication, areas.len());
        for column in 0..self.columns {
            let from = (column as f64 / self.columns as f64) * areas.len() as f64;
            let to = ((column + 1) as f64 / self.columns as f64) * areas.len() as f64;
            let mut inverse = 0.0;
            let mut i = math::floor(from) as usize;
            while (i as f64) < min(areas.len() as f64, to) {
                let overlap = min(to, (i + 1) as f64) - max(from, i as f64);
                inverse += overlap / max(areas[i], 1e-12);
                i += 1;
            }
            let area = max(0.0, (to - from) / inverse);
            let full = self.widths[column];
            let round = math::sqrt((4.0 * area) / (PI * 0.4));
            let blocked = if column.abs_diff(center) <= 1 {
                lateral
            } else {
                0.0
            };
            let width = min(full, round) * (1.0 - blocked) + full * blocked;
            self.fill_column(column, area, width, blocked);
            self.areas[column] = area;
        }
        self.lip_area = max(0.0, areas[areas.len() - 1]);
        self.velum_column = self.column(velum, areas.len());
    }
    fn fill_column(&mut self, column: usize, area: f64, width: f64, blocked: f64) {
        let offset = column * self.rows;
        let half = width / 2.0;
        let h0 = (4.0 * area) / (PI * max(width, 1e-9));
        let mut deepest = offset;
        let ellipse = |t: f64| {
            let t = t.clamp(-1.0, 1.0);
            (t * math::sqrt(1.0 - t * t) + math::asin(t)) / 2.0
        };
        let center = |row: usize| (row as f64 - (self.rows - 1) as f64 / 2.0) * self.dx;
        for row in 0..self.rows {
            let low = (center(row) - self.dx / 2.0) / half;
            let high = (center(row) + self.dx / 2.0) / half;
            let value = if low >= 1.0 || high <= -1.0 {
                0.0
            } else {
                (h0 * half * (ellipse(high) - ellipse(low))) / self.dx
            };
            self.h[offset + row] = value;
            if value > self.h[deepest] {
                deepest = offset + row;
            }
        }
        if self.h[deepest] <= 0.0 {
            deepest = offset + self.rows / 2;
            self.h[deepest] = 1.0;
        }
        if blocked > 0.0 {
            let nearest = (0..self.rows)
                .map(|r| math::abs(center(r)))
                .fold(f64::INFINITY, min);
            let limit = max(width / 6.0, nearest + 1e-9);
            for row in 0..self.rows {
                if math::abs(center(row)) <= limit {
                    self.h[offset + row] *= 1.0 - blocked;
                }
            }
        }
        loop {
            let mut sum = 0.0;
            let mut open = 0;
            let mut shallowest = None;
            for i in offset..offset + self.rows {
                if self.h[i] > 0.0 {
                    sum += self.h[i];
                    open += 1;
                    if shallowest.is_none_or(|old| self.h[i] < self.h[old]) {
                        shallowest = Some(i);
                    }
                }
            }
            if sum <= 0.0 {
                self.h[deepest] = area / self.dx;
                return;
            }
            let scale = area / (sum * self.dx);
            let shallowest = shallowest.unwrap();
            if open > 1 && self.h[shallowest] * scale < 0.02 {
                self.h[shallowest] = 0.0;
                continue;
            }
            for i in offset..offset + self.rows {
                self.h[i] *= scale;
            }
            return;
        }
    }
}
