use serde::{Deserialize, Serialize};
use synapse_catalog::CatalogValue;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BinaryOperator {
    Eq,
    NotEq,
    Lt,
    Lte,
    Gt,
    Gte,
    Like,
}

impl BinaryOperator {
    pub fn as_str(&self) -> &'static str {
        match self {
            BinaryOperator::Eq => "=",
            BinaryOperator::NotEq => "!=",
            BinaryOperator::Lt => "<",
            BinaryOperator::Lte => "<=",
            BinaryOperator::Gt => ">",
            BinaryOperator::Gte => ">=",
            BinaryOperator::Like => "LIKE",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AggregateFunc {
    Count,
    Sum,
    Avg,
    Min,
    Max,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Expr {
    Column(String),
    Literal(CatalogValue),
    BinaryOp {
        left: Box<Expr>,
        op: BinaryOperator,
        right: Box<Expr>,
    },
    Aggregate {
        func: AggregateFunc,
        arg: Option<Box<Expr>>, // None for COUNT(*)
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SelectQuery {
    pub table: String,
    pub projections: Vec<Expr>,
    pub predicate: Option<Expr>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<CatalogValue>>,
    pub execution_time_us: u64,
    pub chunks_scanned: usize,
    pub chunks_pruned: usize,
}
