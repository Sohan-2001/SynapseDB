use crate::vector::ColumnVector;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use synapse_catalog::{CatalogValue, PhysicalType};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnarChunk {
    pub chunk_id: u32,
    pub columns: HashMap<u16, ColumnVector>,
    pub row_count: usize,
    pub capacity: usize,
}

impl ColumnarChunk {
    pub fn new(chunk_id: u32, capacity: usize) -> Self {
        Self {
            chunk_id,
            columns: HashMap::new(),
            row_count: 0,
            capacity,
        }
    }

    pub fn is_full(&self) -> bool {
        self.row_count >= self.capacity
    }

    pub fn get_column_vector(&self, col_id: u16) -> Option<&ColumnVector> {
        self.columns.get(&col_id)
    }

    pub fn ensure_column(&mut self, col_id: u16, ptype: PhysicalType) {
        if !self.columns.contains_key(&col_id) {
            let mut vec = ColumnVector::new(ptype, self.capacity);
            // Pad existing rows with nulls if this column was introduced after earlier rows
            for _ in 0..self.row_count {
                vec.push_null();
            }
            self.columns.insert(col_id, vec);
        }
    }

    pub fn append_row(&mut self, values: &[(u16, PhysicalType, CatalogValue)]) {
        let current_len = self.row_count;

        // Collect incoming column IDs
        let mut incoming_ids = std::collections::HashSet::new();

        for (col_id, ptype, val) in values {
            incoming_ids.insert(*col_id);
            self.ensure_column(*col_id, *ptype);
            let vec = self.columns.get_mut(col_id).unwrap();
            vec.push_value(val);
        }

        // Any existing columns in chunk not present in this row get a NULL
        for (col_id, vec) in self.columns.iter_mut() {
            if !incoming_ids.contains(col_id) && vec.len() == current_len {
                vec.push_null();
            }
        }

        self.row_count += 1;
    }

    /// Fast zone map check: can this chunk satisfy the given filter?
    /// Returns false if this chunk can be skipped completely without scanning.
    pub fn can_satisfy_filter(&self, col_id: u16, op: &str, target: &CatalogValue) -> bool {
        if let Some(col) = self.columns.get(&col_id) {
            col.zone_map().can_satisfy(op, target)
        } else {
            // Column not in chunk, matches only if querying NULL
            target == &CatalogValue::Null
        }
    }
}
