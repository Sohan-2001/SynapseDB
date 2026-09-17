use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PhysicalType {
    Bool,
    Int64,
    Float64,
    Timestamp,
    Utf8,
}

impl fmt::Display for PhysicalType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PhysicalType::Bool => write!(f, "Bool"),
            PhysicalType::Int64 => write!(f, "Int64"),
            PhysicalType::Float64 => write!(f, "Float64"),
            PhysicalType::Timestamp => write!(f, "Timestamp"),
            PhysicalType::Utf8 => write!(f, "Utf8"),
        }
    }
}

impl PhysicalType {
    /// Determines if `from` can be widened implicitly to `to`
    pub fn can_widen_to(from: PhysicalType, to: PhysicalType) -> bool {
        if from == to {
            return true;
        }
        match (from, to) {
            (PhysicalType::Bool, PhysicalType::Int64) => true,
            (PhysicalType::Int64, PhysicalType::Float64) => true,
            (PhysicalType::Bool, PhysicalType::Float64) => true,
            (_, PhysicalType::Utf8) => true,
            _ => false,
        }
    }

    /// Computes the common widened type for two types
    pub fn widen(a: PhysicalType, b: PhysicalType) -> PhysicalType {
        if a == b {
            return a;
        }
        match (a, b) {
            (PhysicalType::Int64, PhysicalType::Float64)
            | (PhysicalType::Float64, PhysicalType::Int64) => PhysicalType::Float64,

            (PhysicalType::Bool, PhysicalType::Int64)
            | (PhysicalType::Int64, PhysicalType::Bool) => PhysicalType::Int64,

            (PhysicalType::Bool, PhysicalType::Float64)
            | (PhysicalType::Float64, PhysicalType::Bool) => PhysicalType::Float64,

            // Any type mixed with Utf8 or incompatible widening widens to Utf8
            _ => PhysicalType::Utf8,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CatalogValue {
    Null,
    Bool(bool),
    Int64(i64),
    Float64(f64),
    Timestamp(i64),
    Utf8(String),
}

impl CatalogValue {
    pub fn physical_type(&self) -> Option<PhysicalType> {
        match self {
            CatalogValue::Null => None,
            CatalogValue::Bool(_) => Some(PhysicalType::Bool),
            CatalogValue::Int64(_) => Some(PhysicalType::Int64),
            CatalogValue::Float64(_) => Some(PhysicalType::Float64),
            CatalogValue::Timestamp(_) => Some(PhysicalType::Timestamp),
            CatalogValue::Utf8(_) => Some(PhysicalType::Utf8),
        }
    }

    pub fn cast_to(&self, target: PhysicalType) -> Option<CatalogValue> {
        match (self, target) {
            (CatalogValue::Null, _) => Some(CatalogValue::Null),
            (CatalogValue::Bool(b), PhysicalType::Bool) => Some(CatalogValue::Bool(*b)),
            (CatalogValue::Bool(b), PhysicalType::Int64) => {
                Some(CatalogValue::Int64(if *b { 1 } else { 0 }))
            }
            (CatalogValue::Bool(b), PhysicalType::Utf8) => {
                Some(CatalogValue::Utf8(b.to_string()))
            }
            (CatalogValue::Int64(i), PhysicalType::Int64) => Some(CatalogValue::Int64(*i)),
            (CatalogValue::Int64(i), PhysicalType::Float64) => {
                Some(CatalogValue::Float64(*i as f64))
            }
            (CatalogValue::Int64(i), PhysicalType::Utf8) => {
                Some(CatalogValue::Utf8(i.to_string()))
            }
            (CatalogValue::Float64(f), PhysicalType::Float64) => Some(CatalogValue::Float64(*f)),
            (CatalogValue::Float64(f), PhysicalType::Utf8) => {
                Some(CatalogValue::Utf8(f.to_string()))
            }
            (CatalogValue::Timestamp(t), PhysicalType::Timestamp) => {
                Some(CatalogValue::Timestamp(*t))
            }
            (CatalogValue::Timestamp(t), PhysicalType::Utf8) => {
                Some(CatalogValue::Utf8(t.to_string()))
            }
            (CatalogValue::Utf8(s), PhysicalType::Utf8) => {
                Some(CatalogValue::Utf8(s.clone()))
            }
            (CatalogValue::Utf8(s), PhysicalType::Int64) => {
                s.parse::<i64>().ok().map(CatalogValue::Int64)
            }
            (CatalogValue::Utf8(s), PhysicalType::Float64) => {
                s.parse::<f64>().ok().map(CatalogValue::Float64)
            }
            (CatalogValue::Utf8(s), PhysicalType::Bool) => {
                match s.to_lowercase().as_str() {
                    "true" | "1" | "yes" => Some(CatalogValue::Bool(true)),
                    "false" | "0" | "no" => Some(CatalogValue::Bool(false)),
                    _ => None,
                }
            }
            _ => None,
        }
    }
}
