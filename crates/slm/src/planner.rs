use regex::Regex;
use std::sync::Arc;
use synapse_catalog::DynamicCatalog;
use synapse_engine::{SelectQuery, SqlParser};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PlannerError {
    #[error("Failed to parse SQL: {0}")]
    SqlParse(String),
    #[error("Could not determine table for natural language query: '{0}'")]
    UnknownTable(String),
    #[error("Could not compile natural language query to SQL: '{0}'")]
    Uncompilable(String),
}

pub struct QueryPlanner {
    catalog: Arc<DynamicCatalog>,
    comparison_regex: Regex,
}

impl QueryPlanner {
    pub fn new(catalog: Arc<DynamicCatalog>) -> Self {
        Self {
            catalog,
            comparison_regex: Regex::new(
                r#"(?i)(?:where\s+)?([a-zA-Z_]+)\s*(>|<|>=|<=|=|==|!=|greater than|less than|equals?)\s*([0-9]+(?:\.[0-9]+)?)"#,
            )
            .unwrap(),
        }
    }

    /// Determines if a query string is direct SQL or Natural Language.
    pub fn is_direct_sql(query_str: &str) -> bool {
        let trimmed = query_str.trim();
        trimmed.to_ascii_uppercase().starts_with("SELECT")
            || trimmed.to_ascii_uppercase().starts_with("SHOW")
            || trimmed.to_ascii_uppercase().starts_with("DESCRIBE")
    }

    /// Compiles any query string (direct SQL or natural language) into a verified SelectQuery AST.
    pub fn plan(&self, input: &str) -> Result<SelectQuery, PlannerError> {
        let trimmed = input.trim();
        if Self::is_direct_sql(trimmed) {
            return SqlParser::parse(trimmed)
                .map_err(|e| PlannerError::SqlParse(e.to_string()));
        }

        self.compile_natural_language(trimmed)
    }

    /// Compiles natural language input into SQL using catalog semantic context.
    pub fn compile_natural_language(&self, nl: &str) -> Result<SelectQuery, PlannerError> {
        let lower = nl.to_lowercase();
        let tables = self.catalog.all_tables();

        // 1. Identify target table
        let target_table = tables
            .iter()
            .find(|t| lower.contains(t.as_str()))
            .cloned()
            .or_else(|| {
                // If only one table exists in catalog, default to it
                if tables.len() == 1 {
                    Some(tables[0].clone())
                } else if tables.is_empty() {
                    // Default fallback table name
                    Some("default".to_string())
                } else {
                    None
                }
            })
            .ok_or_else(|| PlannerError::UnknownTable(nl.to_string()))?;

        let table_schema = self.catalog.get_table(&target_table);

        // 2. Identify aggregation function
        let is_sum = lower.contains("total") || lower.contains("sum") || lower.contains("spent");
        let is_avg = lower.contains("average") || lower.contains("avg") || lower.contains("mean");
        let is_count = lower.contains("how many") || lower.contains("count") || lower.contains("number of");
        let is_max = lower.contains("max") || lower.contains("highest") || lower.contains("most");
        let is_min = lower.contains("min") || lower.contains("lowest") || lower.contains("least");

        // 3. Identify target column by checking words against synonyms and active columns
        let mut target_col = "amount".to_string(); // sensible default for numerical aggregations
        if let Some(ref schema) = table_schema {
            for word in lower.split_whitespace() {
                let clean_word = word.trim_matches(|c: char| !c.is_alphanumeric());
                let canonical = self.catalog.synonyms().resolve(clean_word);
                if schema.get_column_by_name(&canonical).is_some() {
                    target_col = canonical;
                    break;
                }
            }
        }

        // 4. Construct projection SQL
        let proj_sql = if is_count {
            "COUNT(*)".to_string()
        } else if is_avg {
            format!("AVG({})", target_col)
        } else if is_max {
            format!("MAX({})", target_col)
        } else if is_min {
            format!("MIN({})", target_col)
        } else if is_sum {
            format!("SUM({})", target_col)
        } else {
            "*".to_string()
        };

        // 5. Detect predicate (e.g. "amount > 50" or "amount greater than 50")
        let mut where_clause = String::new();
        if let Some(caps) = self.comparison_regex.captures(&lower) {
            let raw_col = &caps[1];
            let canonical_col = self.catalog.synonyms().resolve(raw_col);
            let raw_op = &caps[2];
            let val = &caps[3];

            let op = match raw_op.trim() {
                ">" | "greater than" => ">",
                "<" | "less than" => "<",
                ">=" => ">=",
                "<=" => "<=",
                "=" | "==" | "equal" | "equals" => "=",
                "!=" => "!=",
                _ => "=",
            };

            where_clause = format!(" WHERE {} {} {}", canonical_col, op, val);
        }

        let generated_sql = format!("SELECT {} FROM {}{}", proj_sql, target_table, where_clause);

        SqlParser::parse(&generated_sql).map_err(|e| PlannerError::SqlParse(e.to_string()))
    }
}
