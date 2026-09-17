use crate::chunk::ColumnarChunk;
use crate::segment::SegmentManager;
use std::io;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use synapse_catalog::{CatalogValue, PhysicalType};

pub struct TableMemTable {
    pub table_name: String,
    chunk_capacity: usize,
    active_chunk: RwLock<ColumnarChunk>,
    frozen_chunks: RwLock<Vec<Arc<ColumnarChunk>>>,
    next_chunk_id: AtomicU32,
    segment_manager: Option<Arc<SegmentManager>>,
}

impl TableMemTable {
    pub fn new(
        table_name: &str,
        chunk_capacity: usize,
        segment_manager: Option<Arc<SegmentManager>>,
    ) -> Self {
        Self {
            table_name: table_name.to_string(),
            chunk_capacity,
            active_chunk: RwLock::new(ColumnarChunk::new(0, chunk_capacity)),
            frozen_chunks: RwLock::new(Vec::new()),
            next_chunk_id: AtomicU32::new(1),
            segment_manager,
        }
    }

    pub fn insert_row(&self, values: &[(u16, PhysicalType, CatalogValue)]) -> io::Result<()> {
        let mut active = self.active_chunk.write().unwrap();
        active.append_row(values);

        if active.is_full() {
            let next_id = self.next_chunk_id.fetch_add(1, Ordering::SeqCst);
            let mut new_chunk = ColumnarChunk::new(next_id, self.chunk_capacity);
            std::mem::swap(&mut *active, &mut new_chunk);

            let frozen = Arc::new(new_chunk);
            self.frozen_chunks.write().unwrap().push(Arc::clone(&frozen));

            if let Some(ref sm) = self.segment_manager {
                sm.flush_chunk(&self.table_name, &frozen)?;
            }
        }

        Ok(())
    }

    pub fn flush_active(&self) -> io::Result<()> {
        let mut active = self.active_chunk.write().unwrap();
        if active.row_count == 0 {
            return Ok(());
        }

        let next_id = self.next_chunk_id.fetch_add(1, Ordering::SeqCst);
        let mut new_chunk = ColumnarChunk::new(next_id, self.chunk_capacity);
        std::mem::swap(&mut *active, &mut new_chunk);

        let frozen = Arc::new(new_chunk);
        self.frozen_chunks.write().unwrap().push(Arc::clone(&frozen));

        if let Some(ref sm) = self.segment_manager {
            sm.flush_chunk(&self.table_name, &frozen)?;
        }

        Ok(())
    }

    /// Returns snapshots of all chunks (frozen + active) for scanning.
    pub fn get_all_chunks(&self) -> Vec<Arc<ColumnarChunk>> {
        let mut chunks = self.frozen_chunks.read().unwrap().clone();
        let active = self.active_chunk.read().unwrap();
        if active.row_count > 0 {
            chunks.push(Arc::new(active.clone()));
        }
        chunks
    }

    pub fn total_row_count(&self) -> usize {
        let frozen_count: usize = self.frozen_chunks.read().unwrap().iter().map(|c| c.row_count).sum();
        let active_count = self.active_chunk.read().unwrap().row_count;
        frozen_count + active_count
    }
}
