use crate::ast::{AggregateFunc, BinaryOperator, Expr, QueryResult, SelectQuery};
use std::sync::Arc;
use std::time::Instant;
use synapse_catalog::{CatalogValue, TableSchema};
use synapse_columnar::ColumnarChunk;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum EngineError {
    #[error("Column '{0}' not found in table '{1}'")]
    ColumnNotFound(String, String),
    #[error("Type error: cannot evaluate operator on given types")]
    TypeError,
    #[error("Execution error: {0}")]
    Execution(String),
}

pub struct ExecutionEngine;

impl ExecutionEngine {
    pub fn execute(
        query: &SelectQuery,
        table: &TableSchema,
        chunks: &[Arc<ColumnarChunk>],
    ) -> Result<QueryResult, EngineError> {
        let start_time = Instant::now();
        let mut chunks_scanned = 0;
        let mut chunks_pruned = 0;

        // Check if query is an aggregation
        let has_aggregates = query
            .projections
            .iter()
            .any(|p| matches!(p, Expr::Aggregate { .. }));

        // Resolve predicate column if simple filter
        let simple_filter = Self::extract_simple_filter(&query.predicate, table)?;

        if has_aggregates {
            Self::execute_aggregate(
                query,
                table,
                chunks,
                &simple_filter,
                &mut chunks_scanned,
                &mut chunks_pruned,
                start_time,
            )
        } else {
            Self::execute_scan(
                query,
                table,
                chunks,
                &simple_filter,
                &mut chunks_scanned,
                &mut chunks_pruned,
                start_time,
            )
        }
    }

    fn extract_simple_filter(
        predicate: &Option<Expr>,
        table: &TableSchema,
    ) -> Result<Option<(u16, BinaryOperator, CatalogValue)>, EngineError> {
        match predicate {
            Some(Expr::BinaryOp { left, op, right }) => match (&**left, &**right) {
                (Expr::Column(col_name), Expr::Literal(lit)) => {
                    let col_id = table
                        .get_column_id(col_name)
                        .ok_or_else(|| EngineError::ColumnNotFound(col_name.clone(), table.name.clone()))?;
                    Ok(Some((col_id, *op, lit.clone())))
                }
                _ => Ok(None),
            },
            _ => Ok(None),
        }
    }

    fn execute_aggregate(
        query: &SelectQuery,
        table: &TableSchema,
        chunks: &[Arc<ColumnarChunk>],
        simple_filter: &Option<(u16, BinaryOperator, CatalogValue)>,
        chunks_scanned: &mut usize,
        chunks_pruned: &mut usize,
        start_time: Instant,
    ) -> Result<QueryResult, EngineError> {
        // Prepare aggregate accumulators
        let mut headers = Vec::new();
        let mut accumulators: Vec<Accumulator> = Vec::new();

        for proj in &query.projections {
            match proj {
                Expr::Aggregate { func, arg } => {
                    let func_str = match func {
                        AggregateFunc::Count => "COUNT",
                        AggregateFunc::Sum => "SUM",
                        AggregateFunc::Avg => "AVG",
                        AggregateFunc::Min => "MIN",
                        AggregateFunc::Max => "MAX",
                    };
                    let (header_name, col_id) = match arg {
                        Some(boxed_arg) => match &**boxed_arg {
                            Expr::Column(name) => {
                                let id = table.get_column_id(name).ok_or_else(|| {
                                    EngineError::ColumnNotFound(name.clone(), table.name.clone())
                                })?;
                                (format!("{}({})", func_str, name), Some(id))
                            }
                            _ => (func_str.to_string(), None),
                        },
                        None => ("COUNT(*)".to_string(), None),
                    };
                    headers.push(header_name);
                    accumulators.push(Accumulator::new(*func, col_id));
                }
                _ => {
                    return Err(EngineError::Execution(
                        "Mixing raw columns and aggregates without GROUP BY is unsupported".into(),
                    ))
                }
            }
        }

        for chunk in chunks {
            // Zone map pruning check
            if let Some((col_id, op, target)) = simple_filter {
                if !chunk.can_satisfy_filter(*col_id, op.as_str(), target) {
                    *chunks_pruned += 1;
                    continue;
                }
            }

            *chunks_scanned += 1;

            // Row-by-row scan within chunk
            for row_idx in 0..chunk.row_count {
                if Self::evaluate_predicate(&query.predicate, chunk, row_idx, table)? {
                    for acc in &mut accumulators {
                        acc.accumulate(chunk, row_idx);
                    }
                }
            }
        }

        let row_values: Vec<CatalogValue> = accumulators.into_iter().map(|acc| acc.finalize()).collect();
        let execution_time_us = start_time.elapsed().as_micros() as u64;

        Ok(QueryResult {
            columns: headers,
            rows: vec![row_values],
            execution_time_us,
            chunks_scanned: *chunks_scanned,
            chunks_pruned: *chunks_pruned,
        })
    }

    fn execute_scan(
        query: &SelectQuery,
        table: &TableSchema,
        chunks: &[Arc<ColumnarChunk>],
        simple_filter: &Option<(u16, BinaryOperator, CatalogValue)>,
        chunks_scanned: &mut usize,
        chunks_pruned: &mut usize,
        start_time: Instant,
    ) -> Result<QueryResult, EngineError> {
        let mut headers = Vec::new();
        let mut target_col_ids = Vec::new();

        // Check for SELECT *
        let is_wildcard = query
            .projections
            .iter()
            .any(|p| matches!(p, Expr::Column(s) if s == "*"));

        if is_wildcard {
            for col in table.columns() {
                headers.push(col.name.clone());
                target_col_ids.push(col.id);
            }
        } else {
            for proj in &query.projections {
                match proj {
                    Expr::Column(name) => {
                        let id = table
                            .get_column_id(name)
                            .ok_or_else(|| EngineError::ColumnNotFound(name.clone(), table.name.clone()))?;
                        headers.push(name.clone());
                        target_col_ids.push(id);
                    }
                    _ => {}
                }
            }
        }

        let mut rows = Vec::new();
        let limit = query.limit.unwrap_or(usize::MAX);

        'chunk_loop: for chunk in chunks {
            if let Some((col_id, op, target)) = simple_filter {
                if !chunk.can_satisfy_filter(*col_id, op.as_str(), target) {
                    *chunks_pruned += 1;
                    continue;
                }
            }

            *chunks_scanned += 1;

            for row_idx in 0..chunk.row_count {
                if rows.len() >= limit {
                    break 'chunk_loop;
                }

                if Self::evaluate_predicate(&query.predicate, chunk, row_idx, table)? {
                    let mut row = Vec::with_capacity(target_col_ids.len());
                    for &cid in &target_col_ids {
                        let val = if let Some(vec) = chunk.get_column_vector(cid) {
                            vec.get(row_idx)
                        } else {
                            CatalogValue::Null
                        };
                        row.push(val);
                    }
                    rows.push(row);
                }
            }
        }

        let execution_time_us = start_time.elapsed().as_micros() as u64;

        Ok(QueryResult {
            columns: headers,
            rows,
            execution_time_us,
            chunks_scanned: *chunks_scanned,
            chunks_pruned: *chunks_pruned,
        })
    }

    fn evaluate_predicate(
        predicate: &Option<Expr>,
        chunk: &ColumnarChunk,
        row_idx: usize,
        table: &TableSchema,
    ) -> Result<bool, EngineError> {
        let pred = match predicate {
            Some(p) => p,
            None => return Ok(true),
        };

        match pred {
            Expr::BinaryOp { left, op, right } => {
                let left_val = Self::evaluate_expr(left, chunk, row_idx, table)?;
                let right_val = Self::evaluate_expr(right, chunk, row_idx, table)?;
                Ok(Self::compare_values(&left_val, *op, &right_val))
            }
            _ => Ok(true),
        }
    }

    fn evaluate_expr(
        expr: &Expr,
        chunk: &ColumnarChunk,
        row_idx: usize,
        table: &TableSchema,
    ) -> Result<CatalogValue, EngineError> {
        match expr {
            Expr::Column(name) => {
                let id = table
                    .get_column_id(name)
                    .ok_or_else(|| EngineError::ColumnNotFound(name.clone(), table.name.clone()))?;
                if let Some(col_vec) = chunk.get_column_vector(id) {
                    Ok(col_vec.get(row_idx))
                } else {
                    Ok(CatalogValue::Null)
                }
            }
            Expr::Literal(val) => Ok(val.clone()),
            _ => Err(EngineError::Execution("Complex expression not supported".into())),
        }
    }

    fn compare_values(left: &CatalogValue, op: BinaryOperator, right: &CatalogValue) -> bool {
        match (left, op, right) {
            (CatalogValue::Int64(a), BinaryOperator::Eq, CatalogValue::Int64(b)) => a == b,
            (CatalogValue::Int64(a), BinaryOperator::NotEq, CatalogValue::Int64(b)) => a != b,
            (CatalogValue::Int64(a), BinaryOperator::Lt, CatalogValue::Int64(b)) => a < b,
            (CatalogValue::Int64(a), BinaryOperator::Lte, CatalogValue::Int64(b)) => a <= b,
            (CatalogValue::Int64(a), BinaryOperator::Gt, CatalogValue::Int64(b)) => a > b,
            (CatalogValue::Int64(a), BinaryOperator::Gte, CatalogValue::Int64(b)) => a >= b,

            (CatalogValue::Float64(a), BinaryOperator::Eq, CatalogValue::Float64(b)) => a == b,
            (CatalogValue::Float64(a), BinaryOperator::NotEq, CatalogValue::Float64(b)) => a != b,
            (CatalogValue::Float64(a), BinaryOperator::Lt, CatalogValue::Float64(b)) => a < b,
            (CatalogValue::Float64(a), BinaryOperator::Lte, CatalogValue::Float64(b)) => a <= b,
            (CatalogValue::Float64(a), BinaryOperator::Gt, CatalogValue::Float64(b)) => a > b,
            (CatalogValue::Float64(a), BinaryOperator::Gte, CatalogValue::Float64(b)) => a >= b,

            // Mixed numeric comparison
            (CatalogValue::Float64(a), BinaryOperator::Gt, CatalogValue::Int64(b)) => *a > (*b as f64),
            (CatalogValue::Float64(a), BinaryOperator::Gte, CatalogValue::Int64(b)) => *a >= (*b as f64),
            (CatalogValue::Float64(a), BinaryOperator::Lt, CatalogValue::Int64(b)) => *a < (*b as f64),
            (CatalogValue::Float64(a), BinaryOperator::Lte, CatalogValue::Int64(b)) => *a <= (*b as f64),
            (CatalogValue::Float64(a), BinaryOperator::Eq, CatalogValue::Int64(b)) => *a == (*b as f64),

            (CatalogValue::Int64(a), BinaryOperator::Gt, CatalogValue::Float64(b)) => (*a as f64) > *b,
            (CatalogValue::Int64(a), BinaryOperator::Gte, CatalogValue::Float64(b)) => (*a as f64) >= *b,
            (CatalogValue::Int64(a), BinaryOperator::Lt, CatalogValue::Float64(b)) => (*a as f64) < *b,
            (CatalogValue::Int64(a), BinaryOperator::Lte, CatalogValue::Float64(b)) => (*a as f64) <= *b,
            (CatalogValue::Int64(a), BinaryOperator::Eq, CatalogValue::Float64(b)) => (*a as f64) == *b,

            (CatalogValue::Utf8(a), BinaryOperator::Eq, CatalogValue::Utf8(b)) => a == b,
            (CatalogValue::Utf8(a), BinaryOperator::NotEq, CatalogValue::Utf8(b)) => a != b,
            (CatalogValue::Utf8(a), BinaryOperator::Like, CatalogValue::Utf8(b)) => a.contains(b),

            (CatalogValue::Bool(a), BinaryOperator::Eq, CatalogValue::Bool(b)) => a == b,
            (CatalogValue::Bool(a), BinaryOperator::NotEq, CatalogValue::Bool(b)) => a != b,

            _ => false,
        }
    }
}

enum Accumulator {
    Count { count: i64 },
    Sum { col_id: u16, sum: f64 },
    Avg { col_id: u16, sum: f64, count: i64 },
    Min { col_id: u16, min: Option<f64> },
    Max { col_id: u16, max: Option<f64> },
}

impl Accumulator {
    fn new(func: AggregateFunc, col_id: Option<u16>) -> Self {
        match func {
            AggregateFunc::Count => Accumulator::Count { count: 0 },
            AggregateFunc::Sum => Accumulator::Sum {
                col_id: col_id.unwrap_or(0),
                sum: 0.0,
            },
            AggregateFunc::Avg => Accumulator::Avg {
                col_id: col_id.unwrap_or(0),
                sum: 0.0,
                count: 0,
            },
            AggregateFunc::Min => Accumulator::Min {
                col_id: col_id.unwrap_or(0),
                min: None,
            },
            AggregateFunc::Max => Accumulator::Max {
                col_id: col_id.unwrap_or(0),
                max: None,
            },
        }
    }

    fn accumulate(&mut self, chunk: &ColumnarChunk, row_idx: usize) {
        match self {
            Accumulator::Count { count } => {
                *count += 1;
            }
            Accumulator::Sum { col_id, sum } => {
                if let Some(val) = chunk.get_column_vector(*col_id).map(|v| v.get(row_idx)) {
                    match val {
                        CatalogValue::Int64(i) => *sum += i as f64,
                        CatalogValue::Float64(f) => *sum += f,
                        _ => {}
                    }
                }
            }
            Accumulator::Avg { col_id, sum, count } => {
                if let Some(val) = chunk.get_column_vector(*col_id).map(|v| v.get(row_idx)) {
                    match val {
                        CatalogValue::Int64(i) => {
                            *sum += i as f64;
                            *count += 1;
                        }
                        CatalogValue::Float64(f) => {
                            *sum += f;
                            *count += 1;
                        }
                        _ => {}
                    }
                }
            }
            Accumulator::Min { col_id, min } => {
                if let Some(val) = chunk.get_column_vector(*col_id).map(|v| v.get(row_idx)) {
                    let num = match val {
                        CatalogValue::Int64(i) => Some(i as f64),
                        CatalogValue::Float64(f) => Some(f),
                        _ => None,
                    };
                    if let Some(n) = num {
                        *min = Some(match *min {
                            Some(current) => current.min(n),
                            None => n,
                        });
                    }
                }
            }
            Accumulator::Max { col_id, max } => {
                if let Some(val) = chunk.get_column_vector(*col_id).map(|v| v.get(row_idx)) {
                    let num = match val {
                        CatalogValue::Int64(i) => Some(i as f64),
                        CatalogValue::Float64(f) => Some(f),
                        _ => None,
                    };
                    if let Some(n) = num {
                        *max = Some(match *max {
                            Some(current) => current.max(n),
                            None => n,
                        });
                    }
                }
            }
        }
    }

    fn finalize(self) -> CatalogValue {
        match self {
            Accumulator::Count { count } => CatalogValue::Int64(count),
            Accumulator::Sum { sum, .. } => CatalogValue::Float64(sum),
            Accumulator::Avg { sum, count, .. } => {
                if count == 0 {
                    CatalogValue::Null
                } else {
                    CatalogValue::Float64(sum / (count as f64))
                }
            }
            Accumulator::Min { min, .. } => min.map(CatalogValue::Float64).unwrap_or(CatalogValue::Null),
            Accumulator::Max { max, .. } => max.map(CatalogValue::Float64).unwrap_or(CatalogValue::Null),
        }
    }
}
