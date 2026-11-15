//! The voxel model of the head, packed by `src/engine/pack-model.js`
//! (`packVoxelModel`) into one byte buffer.
//!
//! Layout. All numbers are little-endian. The buffer starts with
//! [`header::WORDS`] u32 words (the [`header`] indices); the arrays follow
//! in this order, each starting at a multiple of 8 bytes (zero padding):
//!
//! | section            | array                    | type | values               |
//! | ------------------ | ------------------------ | ---- | -------------------- |
//! | dx                 | dx                       | f64  | 1                    |
//! | opening (flag)     | binLength, sample        | f64  | 2                    |
//! |                    | bin starts               | i32  | bins + 1             |
//! |                    | weights                  | f64  | points               |
//! |                    | shares                   | f64  | points               |
//! |                    | heads                    | f64  | points + bins        |
//! |                    | tails                    | f64  | points + bins        |
//! |                    | row of each cell (or -1) | i32  | cells                |
//! |                    | cell weights             | f64  | rows * per           |
//! |                    | cell tails               | f64  | rows * (per + 1)     |
//! | cells              | kind                     | i32  | cells                |
//! |                    | tube (-1 for free air)   | i32  | cells                |
//! |                    | arc                      | f64  | cells                |
//! |                    | point (x, y, z)          | f64  | 3 * cells            |
//! | links              | a, b, kind               | i32  | links each           |
//! | openFaces          | open faces               | f64  | cells                |
//! | boundaryAdmittance | admittance               | f64  | 1                    |
//! | enclosure          | 1 with an enclosure      | f64  | 1                    |
//! | lengths            | tract, nose              | f64  | 2                    |
//! | sinuses            | tube, area, length       | f64  | 3 * sinuses          |
//! | landmarks          | lips xyz, nostrils xyz   | f64  | 6                    |
//! | teeth (flag)       | edge, width              | f64  | 2                    |
//! |                    | cells, groups            | i32  | teeth cells each     |
//! | openMasks          | open face bits           | i32  | cells                |
//!
//! Bin `b` of the opening table holds the points `starts[b]..starts[b+1]`
//! of weights and shares, and its heads and tails (one more value each)
//! start at `starts[b] + b`. Only the tract cells have opening rows.

use alloc::vec::Vec;

/// Indices of the u32 header words.
pub mod header {
    /// [`super::MAGIC`].
    pub const MAGIC: usize = 0;
    /// [`super::VERSION`].
    pub const VERSION: usize = 1;
    /// Length of the whole buffer in bytes.
    pub const BYTES: usize = 2;
    /// Number of cells.
    pub const CELLS: usize = 3;
    /// Number of links.
    pub const LINKS: usize = 4;
    /// Number of sinuses.
    pub const SINUSES: usize = 5;
    /// Number of teeth cells.
    pub const TEETH_CELLS: usize = 6;
    /// Sub-cells per tract cell of the opening table.
    pub const OPENING_PER: usize = 7;
    /// Bins of the opening table.
    pub const OPENING_BINS: usize = 8;
    /// Points of all bins of the opening table.
    pub const OPENING_POINTS: usize = 9;
    /// Rows (tract cells) of the opening table.
    pub const OPENING_ROWS: usize = 10;
    /// [`super::flags`] bits.
    pub const FLAGS: usize = 11;
    /// Header words.
    pub const WORDS: usize = 12;
}

/// Bits of [`header::FLAGS`].
pub mod flags {
    /// The model has an opening table.
    pub const OPENING: u32 = 1;
    /// The model has teeth.
    pub const TEETH: u32 = 2;
}

/// 'VSMD' as a little-endian u32.
pub const MAGIC: u32 = 0x444d_5356;
/// Layout version.
pub const VERSION: u32 = 1;

/// Cell kinds (`CELL_*` of voxel-model.js).
pub const CELL_TRACT: u8 = 0;
/// Nasal cavity.
pub const CELL_NOSE: u8 = 1;
/// Free air around the head.
pub const CELL_AIR: u8 = 2;
/// Side branch (sinus).
pub const CELL_SINUS: u8 = 3;

/// Link kinds (`LINK_*` of voxel-model.js).
pub const LINK_INNER: u8 = 0;
/// Lips to free air.
pub const LINK_LIPS: u8 = 1;
/// Nostrils to free air.
pub const LINK_NOSTRILS: u8 = 2;
/// Velopharyngeal port.
pub const LINK_VELUM: u8 = 3;
/// Spherical radiation boundary.
pub const LINK_RADIATION: u8 = 4;
/// Sinus to tract.
pub const LINK_SINUS: u8 = 5;

/// Why a buffer is not a packed model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelError {
    /// Too short, a wrong magic, version or byte count.
    Header,
    /// The arrays do not fit the buffer or the counts.
    Truncated,
    /// A value out of range (a kind, an index or a non-finite number).
    Range,
}

/// The sub-cell table that turns a tract area into the open share of
/// each tract cell (`opening` of voxel-model.js).
#[derive(Clone, Debug, PartialEq)]
pub struct Opening {
    /// Arc length of one bin (cm).
    pub bin_length: f64,
    /// Area of one sub-cell (cm²).
    pub sample: f64,
    /// First point of every bin, and the end.
    pub starts: Vec<usize>,
    /// Weights of the points.
    pub weights: Vec<f64>,
    /// Shares of the points.
    pub shares: Vec<f64>,
    /// Heads of the bins (`points + bins`).
    pub heads: Vec<f64>,
    /// Tails of the bins (`points + bins`).
    pub tails: Vec<f64>,
    /// Row of each cell, `None` for the cells outside the tract.
    pub rows: Vec<Option<usize>>,
    /// Sorted sub-cell weights of the rows (`per` each).
    pub cell_weights: Vec<f64>,
    /// Tails of the rows (`per + 1` each).
    pub cell_tails: Vec<f64>,
    /// Sub-cells per cell.
    pub per: usize,
}

impl Opening {
    /// Number of bins.
    pub fn bins(&self) -> usize {
        self.starts.len() - 1
    }
}

/// A side branch (`sinuses[i]` of voxel-model.js).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sinus {
    /// Tube index of its cells.
    pub tube: i32,
    /// Area (cm²).
    pub area: f64,
    /// Length (cm).
    pub length: f64,
}

/// The incisor cells (`teeth` of voxel-model.js).
#[derive(Clone, Debug, PartialEq)]
pub struct Teeth {
    /// Height of the incisal edge (cm).
    pub edge: f64,
    /// Width of the incisors (cm).
    pub width: f64,
    /// Cells.
    pub cells: Vec<usize>,
    /// Group of each cell.
    pub groups: Vec<i32>,
}

/// The unpacked voxel model.
#[derive(Clone, Debug, PartialEq)]
pub struct Model {
    /// Cell size (cm).
    pub dx: f64,
    /// Sub-cell opening table.
    pub opening: Option<Opening>,
    /// Kind of every cell.
    pub kind: Vec<u8>,
    /// Tube of every cell, -1 in free air.
    pub tube: Vec<i32>,
    /// Arc length of every cell (cm).
    pub arc: Vec<f64>,
    /// Centre of every cell (cm).
    pub point: Vec<[f64; 3]>,
    /// First cell of every link.
    pub link_a: Vec<u32>,
    /// Second cell of every link.
    pub link_b: Vec<u32>,
    /// Kind of every link.
    pub link_kind: Vec<u8>,
    /// Open faces of every cell.
    pub open_faces: Vec<f64>,
    /// Wall admittance per open face.
    pub boundary_admittance: f64,
    /// The model is inside a closed box.
    pub enclosure: bool,
    /// Lengths of the tract and the nose (cm).
    pub lengths: [f64; 2],
    /// Side branches.
    pub sinuses: Vec<Sinus>,
    /// Centre of the lips (cm).
    pub lips: [f64; 3],
    /// Centre of the nostrils (cm).
    pub nostrils: [f64; 3],
    /// Incisors.
    pub teeth: Option<Teeth>,
    /// Bits of the open faces of every cell (+x, −x, +y, −y, +z, −z).
    pub open_masks: Vec<u32>,
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl Reader<'_> {
    fn take(&mut self, size: usize, count: usize) -> Result<&[u8], ModelError> {
        let length = size.checked_mul(count).ok_or(ModelError::Truncated)?;
        let end = self
            .offset
            .checked_add(length)
            .ok_or(ModelError::Truncated)?;
        let slice = self
            .bytes
            .get(self.offset..end)
            .ok_or(ModelError::Truncated)?;
        self.offset = end.div_ceil(8) * 8;
        Ok(slice)
    }

    fn f64s(&mut self, count: usize) -> Result<Vec<f64>, ModelError> {
        let values: Vec<f64> = self
            .take(8, count)?
            .as_chunks::<8>()
            .0
            .iter()
            .map(|chunk| f64::from_le_bytes(*chunk))
            .collect();
        if values.iter().all(|value| value.is_finite()) {
            Ok(values)
        } else {
            Err(ModelError::Range)
        }
    }

    fn i32s(&mut self, count: usize) -> Result<Vec<i32>, ModelError> {
        Ok(self
            .take(4, count)?
            .as_chunks::<4>()
            .0
            .iter()
            .map(|chunk| i32::from_le_bytes(*chunk))
            .collect())
    }

    /// Indices below `limit`.
    fn indices(&mut self, count: usize, limit: usize) -> Result<Vec<usize>, ModelError> {
        self.i32s(count)?
            .into_iter()
            .map(|value| match usize::try_from(value) {
                Ok(index) if index < limit => Ok(index),
                _ => Err(ModelError::Range),
            })
            .collect()
    }
}

fn word(bytes: &[u8], index: usize) -> Result<usize, ModelError> {
    let start = 4 * index;
    let chunk = bytes.get(start..start + 4).ok_or(ModelError::Header)?;
    let value = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
    usize::try_from(value).map_err(|_| ModelError::Header)
}

fn read_opening(reader: &mut Reader, bytes: &[u8], cells: usize) -> Result<Opening, ModelError> {
    let per = word(bytes, header::OPENING_PER)?;
    let bins = word(bytes, header::OPENING_BINS)?;
    let points = word(bytes, header::OPENING_POINTS)?;
    let rows = word(bytes, header::OPENING_ROWS)?;
    if per == 0 || bins == 0 {
        return Err(ModelError::Range);
    }
    let pair = reader.f64s(2)?;
    let starts = reader.indices(bins + 1, points + 1)?;
    if starts[0] != 0 || starts[bins] != points || starts.windows(2).any(|w| w[0] > w[1]) {
        return Err(ModelError::Range);
    }
    let weights = reader.f64s(points)?;
    let shares = reader.f64s(points)?;
    let heads = reader.f64s(points + bins)?;
    let tails = reader.f64s(points + bins)?;
    let rows_of_cells = reader
        .i32s(cells)?
        .into_iter()
        .map(|row| match row {
            -1 => Ok(None),
            _ => match usize::try_from(row) {
                Ok(index) if index < rows => Ok(Some(index)),
                _ => Err(ModelError::Range),
            },
        })
        .collect::<Result<Vec<_>, _>>()?;
    let cell_weights = reader.f64s(rows * per)?;
    let cell_tails = reader.f64s(rows * (per + 1))?;
    Ok(Opening {
        bin_length: pair[0],
        sample: pair[1],
        starts,
        weights,
        shares,
        heads,
        tails,
        rows: rows_of_cells,
        cell_weights,
        cell_tails,
        per,
    })
}

fn triple(values: &[f64]) -> [f64; 3] {
    [values[0], values[1], values[2]]
}

impl Model {
    /// Read a buffer written by `packVoxelModel`.
    pub fn unpack(bytes: &[u8]) -> Result<Self, ModelError> {
        if word(bytes, header::MAGIC)? != MAGIC as usize
            || word(bytes, header::VERSION)? != VERSION as usize
            || word(bytes, header::BYTES)? != bytes.len()
        {
            return Err(ModelError::Header);
        }
        let cells = word(bytes, header::CELLS)?;
        let links = word(bytes, header::LINKS)?;
        let sinuses = word(bytes, header::SINUSES)?;
        let teeth_cells = word(bytes, header::TEETH_CELLS)?;
        let model_flags = word(bytes, header::FLAGS)? as u32;
        let mut reader = Reader {
            bytes,
            offset: (4 * header::WORDS).div_ceil(8) * 8,
        };
        let dx = reader.f64s(1)?[0];
        if dx <= 0.0 {
            return Err(ModelError::Range);
        }
        let opening = if model_flags & flags::OPENING != 0 {
            Some(read_opening(&mut reader, bytes, cells)?)
        } else {
            None
        };
        let kind = reader
            .i32s(cells)?
            .into_iter()
            .map(|kind| match u8::try_from(kind) {
                Ok(kind) if kind <= CELL_SINUS => Ok(kind),
                _ => Err(ModelError::Range),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let tube = reader.i32s(cells)?;
        let arc = reader.f64s(cells)?;
        let point = reader.f64s(3 * cells)?.as_chunks::<3>().0.to_vec();
        let to_u32 = |values: Vec<usize>| values.into_iter().map(|v| v as u32).collect();
        let link_a: Vec<u32> = to_u32(reader.indices(links, cells)?);
        let link_b: Vec<u32> = to_u32(reader.indices(links, cells)?);
        let link_kind = reader
            .i32s(links)?
            .into_iter()
            .map(|kind| match u8::try_from(kind) {
                Ok(kind) if kind <= LINK_SINUS => Ok(kind),
                _ => Err(ModelError::Range),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let open_faces = reader.f64s(cells)?;
        let boundary_admittance = reader.f64s(1)?[0];
        let enclosure = reader.f64s(1)?[0] != 0.0;
        let lengths = reader.f64s(2)?;
        let sinuses = reader
            .f64s(3 * sinuses)?
            .as_chunks::<3>()
            .0
            .iter()
            .map(|[tube, area, length]| Sinus {
                tube: *tube as i32,
                area: *area,
                length: *length,
            })
            .collect();
        let landmarks = reader.f64s(6)?;
        let teeth = if model_flags & flags::TEETH != 0 {
            let size = reader.f64s(2)?;
            Some(Teeth {
                edge: size[0],
                width: size[1],
                cells: reader.indices(teeth_cells, cells)?,
                groups: reader.i32s(teeth_cells)?,
            })
        } else {
            None
        };
        let open_masks = reader
            .i32s(cells)?
            .into_iter()
            .map(|mask| mask as u32)
            .collect();
        if reader.offset != bytes.len() {
            return Err(ModelError::Truncated);
        }
        if let Some(opening) = &opening {
            let missing = kind
                .iter()
                .zip(&opening.rows)
                .any(|(&kind, row)| kind == CELL_TRACT && row.is_none());
            if missing {
                return Err(ModelError::Range);
            }
        }
        Ok(Model {
            dx,
            opening,
            kind,
            tube,
            arc,
            point,
            link_a,
            link_b,
            link_kind,
            open_faces,
            boundary_admittance,
            enclosure,
            lengths: [lengths[0], lengths[1]],
            sinuses,
            lips: triple(&landmarks[..3]),
            nostrils: triple(&landmarks[3..]),
            teeth,
            open_masks,
        })
    }

    /// Number of cells.
    pub fn cells(&self) -> usize {
        self.kind.len()
    }

    /// Number of links.
    pub fn links(&self) -> usize {
        self.link_a.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    /// A two-cell model by hand, the way packVoxelModel lays it out.
    fn packed() -> Vec<u8> {
        let mut words = [0_u32; header::WORDS];
        words[header::MAGIC] = MAGIC;
        words[header::VERSION] = VERSION;
        words[header::CELLS] = 2;
        words[header::LINKS] = 1;
        let mut bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        let f64s = |bytes: &mut Vec<u8>, values: &[f64]| {
            bytes.extend(values.iter().flat_map(|v| v.to_le_bytes()));
            bytes.resize(bytes.len().div_ceil(8) * 8, 0);
        };
        let i32s = |bytes: &mut Vec<u8>, values: &[i32]| {
            bytes.extend(values.iter().flat_map(|v| v.to_le_bytes()));
            bytes.resize(bytes.len().div_ceil(8) * 8, 0);
        };
        f64s(&mut bytes, &[1.0]);
        i32s(&mut bytes, &[1, 2]);
        i32s(&mut bytes, &[1, -1]);
        f64s(&mut bytes, &[0.5, 0.0]);
        f64s(&mut bytes, &[0.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
        i32s(&mut bytes, &[0]);
        i32s(&mut bytes, &[1]);
        i32s(&mut bytes, &[LINK_NOSTRILS as i32]);
        f64s(&mut bytes, &[0.0, 2.0]);
        f64s(&mut bytes, &[1.0]);
        f64s(&mut bytes, &[0.0]);
        f64s(&mut bytes, &[16.0, 10.0]);
        f64s(&mut bytes, &[]);
        f64s(&mut bytes, &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        i32s(&mut bytes, &[0, 3]);
        let length = bytes.len() as u32;
        bytes[4 * header::BYTES..4 * header::BYTES + 4].copy_from_slice(&length.to_le_bytes());
        bytes
    }

    #[test]
    fn unpacks_a_model() {
        let model = Model::unpack(&packed()).unwrap();
        assert_eq!(model.cells(), 2);
        assert_eq!(model.links(), 1);
        assert_eq!(model.kind, vec![CELL_NOSE, CELL_AIR]);
        assert_eq!(model.point[1], [1.0, 0.0, 0.0]);
        assert_eq!(model.link_kind, vec![LINK_NOSTRILS]);
        assert_eq!(model.lengths, [16.0, 10.0]);
        assert_eq!(model.nostrils, [4.0, 5.0, 6.0]);
        assert_eq!(model.open_masks, vec![0, 3]);
        assert!(model.opening.is_none() && model.teeth.is_none());
    }

    #[test]
    fn refuses_a_bad_buffer() {
        let bytes = packed();
        assert_eq!(Model::unpack(&bytes[..8]), Err(ModelError::Header));
        let mut longer = bytes.clone();
        longer.extend([0; 8]);
        assert_eq!(Model::unpack(&longer), Err(ModelError::Header));
        let mut link = bytes.clone();
        // The first link points past the cells.
        let at = 48 + 8 + 8 + 8 + 16 + 48;
        link[at..at + 4].copy_from_slice(&7_i32.to_le_bytes());
        assert_eq!(Model::unpack(&link), Err(ModelError::Range));
    }
}
