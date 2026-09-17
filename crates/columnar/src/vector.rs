use serde::{Deserialize, Serialize};
use synapse_catalog::{CatalogValue, PhysicalType};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZoneMap {
    pub min_value: Option<CatalogValue>,
    pub max_value: Option<CatalogValue>,
    pub null_count: usize,
    pub row_count: usize,
}

impl ZoneMap {
    pub fn new() -> Self {
        Self {
            min_value: None,
            max_value: None,
            null_count: 0,
            row_count: 0,
        }
    }

    pub fn update(&mut self, val: &CatalogValue) {
        self.row_count += 1;
        if val == &CatalogValue::Null {
            self.null_count += 1;
            return;
        }

        match (&mut self.min_value, &mut self.max_value) {
            (None, None) => {
                self.min_value = Some(val.clone());
                self.max_value = Some(val.clone());
            }
            (Some(ref mut min), Some(ref mut max)) => match (val, &min, &max) {
                (CatalogValue::Int64(v), CatalogValue::Int64(cur_min), CatalogValue::Int64(cur_max)) => {
                    if v < cur_min {
                        *min = CatalogValue::Int64(*v);
                    }
                    if v > cur_max {
                        *max = CatalogValue::Int64(*v);
                    }
                }
                (CatalogValue::Float64(v), CatalogValue::Float64(cur_min), CatalogValue::Float64(cur_max)) => {
                    if v < cur_min {
                        *min = CatalogValue::Float64(*v);
                    }
                    if v > cur_max {
                        *max = CatalogValue::Float64(*v);
                    }
                }
                (CatalogValue::Timestamp(v), CatalogValue::Timestamp(cur_min), CatalogValue::Timestamp(cur_max)) => {
                    if v < cur_min {
                        *min = CatalogValue::Timestamp(*v);
                    }
                    if v > cur_max {
                        *max = CatalogValue::Timestamp(*v);
                    }
                }
                (CatalogValue::Utf8(v), CatalogValue::Utf8(cur_min), CatalogValue::Utf8(cur_max)) => {
                    if v < cur_min {
                        *min = CatalogValue::Utf8(v.clone());
                    }
                    if v > cur_max {
                        *max = CatalogValue::Utf8(v.clone());
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }

    /// Checks whether any rows in this chunk could possibly satisfy `col <op> target`.
    /// Returns false if the chunk can be guaranteed safe to prune/skip.
    pub fn can_satisfy(&self, op: &str, target: &CatalogValue) -> bool {
        // If all rows are null and we aren't querying IS NULL, prune
        if self.null_count == self.row_count && self.row_count > 0 {
            return false;
        }

        let (min, max) = match (&self.min_value, &self.max_value) {
            (Some(min), Some(max)) => (min, max),
            _ => return true, // No bounds available, cannot prune
        };

        match (op, min, max, target) {
            ("=", CatalogValue::Int64(min), CatalogValue::Int64(max), CatalogValue::Int64(tgt)) => {
                tgt >= min && tgt <= max
            }
            (">", CatalogValue::Int64(_), CatalogValue::Int64(max), CatalogValue::Int64(tgt)) => {
                max > tgt
            }
            (">=", CatalogValue::Int64(_), CatalogValue::Int64(max), CatalogValue::Int64(tgt)) => {
                max >= tgt
            }
            ("<", CatalogValue::Int64(min), CatalogValue::Int64(_), CatalogValue::Int64(tgt)) => {
                min < tgt
            }
            ("<=", CatalogValue::Int64(min), CatalogValue::Int64(_), CatalogValue::Int64(tgt)) => {
                min <= tgt
            }

            // Float64 comparisons
            ("=", CatalogValue::Float64(min), CatalogValue::Float64(max), CatalogValue::Float64(tgt)) => {
                tgt >= min && tgt <= max
            }
            (">", CatalogValue::Float64(_), CatalogValue::Float64(max), CatalogValue::Float64(tgt)) => {
                max > tgt
            }
            (">=", CatalogValue::Float64(_), CatalogValue::Float64(max), CatalogValue::Float64(tgt)) => {
                max >= tgt
            }
            ("<", CatalogValue::Float64(min), CatalogValue::Float64(_), CatalogValue::Float64(tgt)) => {
                min < tgt
            }
            ("<=", CatalogValue::Float64(min), CatalogValue::Float64(_), CatalogValue::Float64(tgt)) => {
                min <= tgt
            }

            _ => true, // Conservatively keep
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ColumnVector {
    Int64 {
        values: Vec<i64>,
        validity: Vec<bool>,
        zone_map: ZoneMap,
    },
    Float64 {
        values: Vec<f64>,
        validity: Vec<bool>,
        zone_map: ZoneMap,
    },
    Timestamp {
        values: Vec<i64>,
        validity: Vec<bool>,
        zone_map: ZoneMap,
    },
    Utf8 {
        data: Vec<u8>,
        offsets: Vec<u32>, // offsets[i]..offsets[i+1]
        validity: Vec<bool>,
        zone_map: ZoneMap,
    },
    Bool {
        values: Vec<bool>,
        validity: Vec<bool>,
        zone_map: ZoneMap,
    },
}

impl ColumnVector {
    pub fn new(physical_type: PhysicalType, initial_capacity: usize) -> Self {
        match physical_type {
            PhysicalType::Int64 => ColumnVector::Int64 {
                values: Vec::with_capacity(initial_capacity),
                validity: Vec::with_capacity(initial_capacity),
                zone_map: ZoneMap::new(),
            },
            PhysicalType::Float64 => ColumnVector::Float64 {
                values: Vec::with_capacity(initial_capacity),
                validity: Vec::with_capacity(initial_capacity),
                zone_map: ZoneMap::new(),
            },
            PhysicalType::Timestamp => ColumnVector::Timestamp {
                values: Vec::with_capacity(initial_capacity),
                validity: Vec::with_capacity(initial_capacity),
                zone_map: ZoneMap::new(),
            },
            PhysicalType::Utf8 => {
                let mut offsets = Vec::with_capacity(initial_capacity + 1);
                offsets.push(0);
                ColumnVector::Utf8 {
                    data: Vec::with_capacity(initial_capacity * 16),
                    offsets,
                    validity: Vec::with_capacity(initial_capacity),
                    zone_map: ZoneMap::new(),
                }
            }
            PhysicalType::Bool => ColumnVector::Bool {
                values: Vec::with_capacity(initial_capacity),
                validity: Vec::with_capacity(initial_capacity),
                zone_map: ZoneMap::new(),
            },
        }
    }

    pub fn len(&self) -> usize {
        match self {
            ColumnVector::Int64 { values, .. } => values.len(),
            ColumnVector::Float64 { values, .. } => values.len(),
            ColumnVector::Timestamp { values, .. } => values.len(),
            ColumnVector::Utf8 { validity, .. } => validity.len(),
            ColumnVector::Bool { values, .. } => values.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn physical_type(&self) -> PhysicalType {
        match self {
            ColumnVector::Int64 { .. } => PhysicalType::Int64,
            ColumnVector::Float64 { .. } => PhysicalType::Float64,
            ColumnVector::Timestamp { .. } => PhysicalType::Timestamp,
            ColumnVector::Utf8 { .. } => PhysicalType::Utf8,
            ColumnVector::Bool { .. } => PhysicalType::Bool,
        }
    }

    pub fn zone_map(&self) -> &ZoneMap {
        match self {
            ColumnVector::Int64 { zone_map, .. }
            | ColumnVector::Float64 { zone_map, .. }
            | ColumnVector::Timestamp { zone_map, .. }
            | ColumnVector::Utf8 { zone_map, .. }
            | ColumnVector::Bool { zone_map, .. } => zone_map,
        }
    }

    pub fn push_value(&mut self, val: &CatalogValue) {
        match (self, val) {
            (ColumnVector::Int64 { values, validity, zone_map }, CatalogValue::Int64(v)) => {
                values.push(*v);
                validity.push(true);
                zone_map.update(val);
            }
            (ColumnVector::Float64 { values, validity, zone_map }, CatalogValue::Float64(v)) => {
                values.push(*v);
                validity.push(true);
                zone_map.update(val);
            }
            (ColumnVector::Float64 { values, validity, zone_map }, CatalogValue::Int64(v)) => {
                let f = *v as f64;
                values.push(f);
                validity.push(true);
                zone_map.update(&CatalogValue::Float64(f));
            }
            (ColumnVector::Timestamp { values, validity, zone_map }, CatalogValue::Timestamp(v)) => {
                values.push(*v);
                validity.push(true);
                zone_map.update(val);
            }
            (ColumnVector::Utf8 { data, offsets, validity, zone_map }, CatalogValue::Utf8(s)) => {
                data.extend_from_slice(s.as_bytes());
                offsets.push(data.len() as u32);
                validity.push(true);
                zone_map.update(val);
            }
            (ColumnVector::Bool { values, validity, zone_map }, CatalogValue::Bool(b)) => {
                values.push(*b);
                validity.push(true);
                zone_map.update(val);
            }
            (vec, CatalogValue::Null) => {
                vec.push_null();
            }
            (vec, other) => {
                // Try casting
                let target_type = vec.physical_type();
                if let Some(casted) = other.cast_to(target_type) {
                    vec.push_value(&casted);
                } else {
                    vec.push_null();
                }
            }
        }
    }

    pub fn push_null(&mut self) {
        match self {
            ColumnVector::Int64 { values, validity, zone_map } => {
                values.push(0);
                validity.push(false);
                zone_map.update(&CatalogValue::Null);
            }
            ColumnVector::Float64 { values, validity, zone_map } => {
                values.push(0.0);
                validity.push(false);
                zone_map.update(&CatalogValue::Null);
            }
            ColumnVector::Timestamp { values, validity, zone_map } => {
                values.push(0);
                validity.push(false);
                zone_map.update(&CatalogValue::Null);
            }
            ColumnVector::Utf8 { data: _, offsets, validity, zone_map } => {
                let current_offset = *offsets.last().unwrap_or(&0);
                offsets.push(current_offset);
                validity.push(false);
                zone_map.update(&CatalogValue::Null);
            }
            ColumnVector::Bool { values, validity, zone_map } => {
                values.push(false);
                validity.push(false);
                zone_map.update(&CatalogValue::Null);
            }
        }
    }

    pub fn get(&self, idx: usize) -> CatalogValue {
        match self {
            ColumnVector::Int64 { values, validity, .. } => {
                if validity[idx] {
                    CatalogValue::Int64(values[idx])
                } else {
                    CatalogValue::Null
                }
            }
            ColumnVector::Float64 { values, validity, .. } => {
                if validity[idx] {
                    CatalogValue::Float64(values[idx])
                } else {
                    CatalogValue::Null
                }
            }
            ColumnVector::Timestamp { values, validity, .. } => {
                if validity[idx] {
                    CatalogValue::Timestamp(values[idx])
                } else {
                    CatalogValue::Null
                }
            }
            ColumnVector::Utf8 { data, offsets, validity, .. } => {
                if validity[idx] {
                    let start = offsets[idx] as usize;
                    let end = offsets[idx + 1] as usize;
                    let s = String::from_utf8_lossy(&data[start..end]).to_string();
                    CatalogValue::Utf8(s)
                } else {
                    CatalogValue::Null
                }
            }
            ColumnVector::Bool { values, validity, .. } => {
                if validity[idx] {
                    CatalogValue::Bool(values[idx])
                } else {
                    CatalogValue::Null
                }
            }
        }
    }
}
