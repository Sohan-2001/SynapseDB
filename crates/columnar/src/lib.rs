pub mod chunk;
pub mod memtable;
pub mod segment;
pub mod vector;

pub use chunk::ColumnarChunk;
pub use memtable::TableMemTable;
pub use segment::SegmentManager;
pub use vector::{ColumnVector, ZoneMap};

#[cfg(test)]
mod tests {
    use super::*;
    use synapse_catalog::{CatalogValue, PhysicalType};
    use tempfile::tempdir;

    #[test]
    fn test_zone_map_min_max_pruning() {
        let mut vec = ColumnVector::new(PhysicalType::Float64, 10);
        vec.push_value(&CatalogValue::Float64(10.5));
        vec.push_value(&CatalogValue::Float64(25.0));
        vec.push_value(&CatalogValue::Float64(42.0));

        let zm = vec.zone_map();
        assert_eq!(zm.min_value, Some(CatalogValue::Float64(10.5)));
        assert_eq!(zm.max_value, Some(CatalogValue::Float64(42.0)));

        // Filter: amount > 50.0 -> Should NOT satisfy
        assert_eq!(zm.can_satisfy(">", &CatalogValue::Float64(50.0)), false);
        // Filter: amount > 20.0 -> Can satisfy
        assert_eq!(zm.can_satisfy(">", &CatalogValue::Float64(20.0)), true);
        // Filter: amount < 5.0 -> Should NOT satisfy
        assert_eq!(zm.can_satisfy("<", &CatalogValue::Float64(5.0)), false);
        // Filter: amount = 25.0 -> Can satisfy
        assert_eq!(zm.can_satisfy("=", &CatalogValue::Float64(25.0)), true);
        // Filter: amount = 100.0 -> Should NOT satisfy
        assert_eq!(zm.can_satisfy("=", &CatalogValue::Float64(100.0)), false);
    }

    #[test]
    fn test_memtable_flush_and_reload() {
        let dir = tempdir().unwrap();
        let sm = std::sync::Arc::new(SegmentManager::new(dir.path()).unwrap());

        // Capacity of 3 rows per chunk to trigger automatic freeze
        let memtable = TableMemTable::new("orders", 3, Some(sm.clone()));

        memtable
            .insert_row(&[
                (0, PhysicalType::Int64, CatalogValue::Int64(1)),
                (1, PhysicalType::Float64, CatalogValue::Float64(15.0)),
            ])
            .unwrap();

        memtable
            .insert_row(&[
                (0, PhysicalType::Int64, CatalogValue::Int64(2)),
                (1, PhysicalType::Float64, CatalogValue::Float64(25.0)),
            ])
            .unwrap();

        memtable
            .insert_row(&[
                (0, PhysicalType::Int64, CatalogValue::Int64(3)),
                (1, PhysicalType::Float64, CatalogValue::Float64(35.0)),
            ])
            .unwrap();

        // 4th row should trigger flush of chunk 0
        memtable
            .insert_row(&[
                (0, PhysicalType::Int64, CatalogValue::Int64(4)),
                (1, PhysicalType::Float64, CatalogValue::Float64(45.0)),
            ])
            .unwrap();

        assert_eq!(memtable.total_row_count(), 4);

        // Load segments from disk
        let disk_segments = sm.load_all_segments("orders").unwrap();
        assert_eq!(disk_segments.len(), 1);
        assert_eq!(disk_segments[0].row_count, 3);
    }
}
