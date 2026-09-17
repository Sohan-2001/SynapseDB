use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use synapse_catalog::CatalogValue;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedSchemaPayload {
    pub columns: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ExtractedRecord {
    pub row_id: u64,
    pub table_name: String,
    pub fields: Vec<(String, CatalogValue)>,
    pub tags: Vec<String>,
}

pub struct SchemaExtractor {
    kv_regex: Regex,
    currency_regex: Regex,
}

impl Default for SchemaExtractor {
    fn default() -> Self {
        Self::new()
    }
}

impl SchemaExtractor {
    pub fn new() -> Self {
        Self {
            kv_regex: Regex::new(r#"([a-zA-Z_][a-zA-Z0-9_-]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)"#).unwrap(),
            currency_regex: Regex::new(r#"\$([0-9]+(?:\.[0-9]+)?)"#).unwrap(),
        }
    }

    /// Primary entry point: extracts structured columns and values from raw bytes/strings.
    /// 1. Tries direct JSON parsing matching {"columns": {...}} or flat JSON {"fare": 25.5}
    /// 2. If unstructured log/string, applies entity extraction and token mapping
    pub fn extract(&self, row_id: u64, table_name: &str, raw_text: &str) -> ExtractedRecord {
        let trimmed = raw_text.trim();

        // 1. Try JSON parsing
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if let Ok(payload) = serde_json::from_str::<ExtractedSchemaPayload>(trimmed) {
                return self.from_payload(row_id, table_name, payload);
            }
            if let Ok(flat_map) = serde_json::from_str::<HashMap<String, serde_json::Value>>(trimmed) {
                let payload = ExtractedSchemaPayload {
                    columns: flat_map,
                    tags: Vec::new(),
                };
                return self.from_payload(row_id, table_name, payload);
            }
        }

        // 2. Unstructured string/log extraction via regex & entity recognizer
        let mut fields = Vec::new();
        let mut tags = Vec::new();

        // Check key-value patterns: e.g. "user_id: 123 amount=45.67 status: completed"
        for cap in self.kv_regex.captures_iter(trimmed) {
            let key = cap[1].to_string();
            let raw_val = cap[2].trim_matches(|c| c == '\'' || c == '"');
            let cat_val = self.parse_value_string(raw_val);
            fields.push((key, cat_val));
        }

        // Check standalone currency patterns: e.g. "Ride ended for $42.50"
        if fields.iter().all(|(k, _)| k != "amount" && k != "fare" && k != "price") {
            if let Some(cap) = self.currency_regex.captures(trimmed) {
                if let Ok(amount) = cap[1].parse::<f64>() {
                    fields.push(("amount".to_string(), CatalogValue::Float64(amount)));
                }
            }
        }

        // If no key-value pairs could be parsed, store the raw text as a "message" column
        if fields.is_empty() {
            fields.push(("message".to_string(), CatalogValue::Utf8(trimmed.to_string())));
            tags.push("unparsed_text".to_string());
        }

        ExtractedRecord {
            row_id,
            table_name: table_name.to_string(),
            fields,
            tags,
        }
    }

    fn from_payload(
        &self,
        row_id: u64,
        table_name: &str,
        payload: ExtractedSchemaPayload,
    ) -> ExtractedRecord {
        let mut fields = Vec::new();
        for (col, val) in payload.columns {
            let cat_val = match val {
                serde_json::Value::Null => CatalogValue::Null,
                serde_json::Value::Bool(b) => CatalogValue::Bool(b),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        CatalogValue::Int64(i)
                    } else if let Some(f) = n.as_f64() {
                        CatalogValue::Float64(f)
                    } else {
                        CatalogValue::Null
                    }
                }
                serde_json::Value::String(s) => CatalogValue::Utf8(s),
                other => CatalogValue::Utf8(other.to_string()),
            };
            fields.push((col, cat_val));
        }

        ExtractedRecord {
            row_id,
            table_name: table_name.to_string(),
            fields,
            tags: payload.tags,
        }
    }

    fn parse_value_string(&self, s: &str) -> CatalogValue {
        if let Ok(i) = s.parse::<i64>() {
            return CatalogValue::Int64(i);
        }
        if let Ok(f) = s.parse::<f64>() {
            return CatalogValue::Float64(f);
        }
        if s.eq_ignore_ascii_case("true") {
            return CatalogValue::Bool(true);
        }
        if s.eq_ignore_ascii_case("false") {
            return CatalogValue::Bool(false);
        }
        if s.eq_ignore_ascii_case("null") {
            return CatalogValue::Null;
        }
        CatalogValue::Utf8(s.to_string())
    }
}
