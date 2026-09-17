pub mod schema;
pub mod synonyms;
pub mod types;

pub use schema::{ColumnDefinition, DynamicCatalog, TableSchema};
pub use synonyms::SynonymMap;
pub use types::{CatalogValue, PhysicalType};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn test_synonym_resolution() {
        let catalog = DynamicCatalog::default();
        let (table, cols) = catalog.evolve_schema(
            "rides",
            &[
                ("fare".to_string(), PhysicalType::Float64),
                ("user".to_string(), PhysicalType::Int64),
                ("time".to_string(), PhysicalType::Timestamp),
            ],
        );

        assert_eq!(table.name, "rides");
        assert_eq!(cols.len(), 3);
        assert_eq!(cols[0].name, "amount");
        assert_eq!(cols[0].physical_type, PhysicalType::Float64);
        assert_eq!(cols[1].name, "user_id");
        assert_eq!(cols[1].physical_type, PhysicalType::Int64);
        assert_eq!(cols[2].name, "timestamp");
        assert_eq!(cols[2].physical_type, PhysicalType::Timestamp);
    }

    #[test]
    fn test_schema_evolution_and_type_widening() {
        let catalog = DynamicCatalog::default();

        // 1. Initial insert with Int64
        let (table, cols1) = catalog.evolve_schema(
            "orders",
            &[("quantity".to_string(), PhysicalType::Int64)],
        );
        assert_eq!(cols1[0].physical_type, PhysicalType::Int64);

        // 2. Later insert with Float64 for the same column
        let (_, cols2) = catalog.evolve_schema(
            "orders",
            &[("quantity".to_string(), PhysicalType::Float64)],
        );
        assert_eq!(cols2[0].physical_type, PhysicalType::Float64);

        // Verify catalog current state has widened type
        let col = table.get_column_by_name("quantity").unwrap();
        assert_eq!(col.physical_type, PhysicalType::Float64);
    }

    #[test]
    fn test_concurrent_schema_evolution() {
        let catalog = Arc::new(DynamicCatalog::default());
        let mut handles = Vec::new();

        for t in 0..10 {
            let cat = Arc::clone(&catalog);
            handles.push(thread::spawn(move || {
                for i in 0..50 {
                    let col_name = format!("metric_{}", (t * 50 + i) % 20);
                    cat.evolve_schema("metrics", &[(col_name, PhysicalType::Int64)]);
                }
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        let table = catalog.get_table("metrics").unwrap();
        assert_eq!(table.columns().len(), 20);
    }
}
