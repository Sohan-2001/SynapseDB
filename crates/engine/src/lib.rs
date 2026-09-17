pub mod ast;
pub mod evaluator;
pub mod parser;

pub use ast::{AggregateFunc, BinaryOperator, Expr, QueryResult, SelectQuery};
pub use evaluator::{EngineError, ExecutionEngine};
pub use parser::{ParseError, SqlParser};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use synapse_catalog::{CatalogValue, DynamicCatalog, PhysicalType};
    use synapse_columnar::ColumnarChunk;

    #[test]
    fn test_sql_parser_basic() {
        let sql = "SELECT amount, user_id FROM rides WHERE amount > 50 LIMIT 10";
        let query = SqlParser::parse(sql).unwrap();

        assert_eq!(query.table, "rides");
        assert_eq!(query.projections.len(), 2);
        assert_eq!(query.projections[0], Expr::Column("amount".to_string()));
        assert_eq!(query.projections[1], Expr::Column("user_id".to_string()));
        assert_eq!(query.limit, Some(10));

        match query.predicate {
            Some(Expr::BinaryOp { left, op, right }) => {
                assert_eq!(*left, Expr::Column("amount".to_string()));
                assert_eq!(op, BinaryOperator::Gt);
                assert_eq!(*right, Expr::Literal(CatalogValue::Int64(50)));
            }
            _ => panic!("Expected binary op predicate"),
        }
    }

    #[test]
    fn test_sql_parser_aggregate() {
        let sql = "SELECT SUM(amount), COUNT(*), AVG(amount) FROM rides WHERE amount >= 20.0";
        let query = SqlParser::parse(sql).unwrap();

        assert_eq!(query.table, "rides");
        assert_eq!(query.projections.len(), 3);
        assert_eq!(
            query.projections[0],
            Expr::Aggregate {
                func: AggregateFunc::Sum,
                arg: Some(Box::new(Expr::Column("amount".to_string()))),
            }
        );
        assert_eq!(
            query.projections[1],
            Expr::Aggregate {
                func: AggregateFunc::Count,
                arg: None,
            }
        );
    }

    #[test]
    fn test_execution_with_zone_map_pruning() {
        let catalog = DynamicCatalog::default();
        let (table, _) = catalog.evolve_schema(
            "rides",
            &[
                ("amount".to_string(), PhysicalType::Float64),
                ("user_id".to_string(), PhysicalType::Int64),
            ],
        );

        let amount_col = table.get_column_id("amount").unwrap();
        let user_col = table.get_column_id("user_id").unwrap();

        // Chunk 1: amount values [10.0, 20.0, 30.0] (max = 30.0)
        let mut chunk1 = ColumnarChunk::new(1, 10);
        chunk1.append_row(&[
            (amount_col, PhysicalType::Float64, CatalogValue::Float64(10.0)),
            (user_col, PhysicalType::Int64, CatalogValue::Int64(1)),
        ]);
        chunk1.append_row(&[
            (amount_col, PhysicalType::Float64, CatalogValue::Float64(20.0)),
            (user_col, PhysicalType::Int64, CatalogValue::Int64(2)),
        ]);
        chunk1.append_row(&[
            (amount_col, PhysicalType::Float64, CatalogValue::Float64(30.0)),
            (user_col, PhysicalType::Int64, CatalogValue::Int64(3)),
        ]);

        // Chunk 2: amount values [70.0, 80.0, 90.0] (min = 70.0, max = 90.0)
        let mut chunk2 = ColumnarChunk::new(2, 10);
        chunk2.append_row(&[
            (amount_col, PhysicalType::Float64, CatalogValue::Float64(70.0)),
            (user_col, PhysicalType::Int64, CatalogValue::Int64(4)),
        ]);
        chunk2.append_row(&[
            (amount_col, PhysicalType::Float64, CatalogValue::Float64(80.0)),
            (user_col, PhysicalType::Int64, CatalogValue::Int64(5)),
        ]);
        chunk2.append_row(&[
            (amount_col, PhysicalType::Float64, CatalogValue::Float64(90.0)),
            (user_col, PhysicalType::Int64, CatalogValue::Int64(6)),
        ]);

        let chunks = vec![Arc::new(chunk1), Arc::new(chunk2)];

        // Query with filter: WHERE amount > 50.0
        let sql = "SELECT SUM(amount), COUNT(*) FROM rides WHERE amount > 50.0";
        let query = SqlParser::parse(sql).unwrap();

        let result = ExecutionEngine::execute(&query, &table, &chunks).unwrap();

        // Chunk 1 should have been pruned (max is 30.0 <= 50.0)
        assert_eq!(result.chunks_pruned, 1);
        assert_eq!(result.chunks_scanned, 1);

        // Exact sum: 70.0 + 80.0 + 90.0 = 240.0, count = 3
        assert_eq!(result.rows[0][0], CatalogValue::Float64(240.0));
        assert_eq!(result.rows[0][1], CatalogValue::Int64(3));
    }
}
