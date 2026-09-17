pub mod extractor;
pub mod planner;
pub mod worker_pool;

pub use extractor::{ExtractedRecord, ExtractedSchemaPayload, SchemaExtractor};
pub use planner::{PlannerError, QueryPlanner};
pub use worker_pool::{MicroBatchingCoordinator, RawRecord};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use synapse_catalog::{DynamicCatalog, PhysicalType};
    use synapse_engine::AggregateFunc;

    #[test]
    fn test_extractor_json_and_unstructured() {
        let extractor = SchemaExtractor::new();

        // 1. JSON payload
        let rec1 = extractor.extract(1, "orders", r#"{"fare": 42.50, "user_id": 1001}"#);
        assert_eq!(rec1.fields.len(), 2);

        // 2. Unstructured log line
        let rec2 = extractor.extract(2, "rides", "Completed ride with user_id: 2045 and total fare of $35.00");
        let fields: std::collections::HashMap<_, _> = rec2.fields.into_iter().collect();
        assert!(fields.contains_key("user_id") || fields.contains_key("amount"));
    }

    #[test]
    fn test_nl_query_compilation() {
        let catalog = Arc::new(DynamicCatalog::default());
        catalog.evolve_schema("taxi", &[("amount".to_string(), PhysicalType::Float64)]);

        let planner = QueryPlanner::new(catalog);

        // Natural language query test
        let query = planner.plan("Total taxi spent where amount > 25").unwrap();
        assert_eq!(query.table, "taxi");
        assert_eq!(query.projections.len(), 1);
        match &query.projections[0] {
            synapse_engine::Expr::Aggregate { func, .. } => {
                assert_eq!(*func, AggregateFunc::Sum);
            }
            _ => panic!("Expected aggregate expression"),
        }
    }
}
