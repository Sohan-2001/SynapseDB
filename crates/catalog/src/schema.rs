use crate::synonyms::SynonymMap;
use crate::types::PhysicalType;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ColumnDefinition {
    pub id: u16,
    pub name: String,
    pub physical_type: PhysicalType,
}

#[derive(Debug)]
pub struct TableSchema {
    pub name: String,
    columns: RwLock<Vec<ColumnDefinition>>,
    name_to_id: RwLock<HashMap<String, u16>>,
    next_col_id: AtomicU16,
}

impl TableSchema {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            columns: RwLock::new(Vec::new()),
            name_to_id: RwLock::new(HashMap::new()),
            next_col_id: AtomicU16::new(0),
        }
    }

    pub fn get_column_id(&self, canonical_name: &str) -> Option<u16> {
        self.name_to_id.read().unwrap().get(canonical_name).copied()
    }

    pub fn get_column(&self, id: u16) -> Option<ColumnDefinition> {
        let cols = self.columns.read().unwrap();
        cols.iter().find(|c| c.id == id).cloned()
    }

    pub fn get_column_by_name(&self, canonical_name: &str) -> Option<ColumnDefinition> {
        let id = self.get_column_id(canonical_name)?;
        self.get_column(id)
    }

    pub fn columns(&self) -> Vec<ColumnDefinition> {
        self.columns.read().unwrap().clone()
    }

    /// Register a new column or widen an existing column if needed.
    pub fn register_or_widen_column(&self, canonical_name: &str, ptype: PhysicalType) -> ColumnDefinition {
        if let Some(col_id) = self.get_column_id(canonical_name) {
            let mut cols = self.columns.write().unwrap();
            if let Some(col) = cols.iter_mut().find(|c| c.id == col_id) {
                if col.physical_type != ptype {
                    let widened = PhysicalType::widen(col.physical_type, ptype);
                    col.physical_type = widened;
                }
                return col.clone();
            }
        }

        // Column doesn't exist yet, insert
        let mut cols = self.columns.write().unwrap();
        let mut name_map = self.name_to_id.write().unwrap();

        if let Some(&col_id) = name_map.get(canonical_name) {
            if let Some(col) = cols.iter_mut().find(|c| c.id == col_id) {
                if col.physical_type != ptype {
                    col.physical_type = PhysicalType::widen(col.physical_type, ptype);
                }
                return col.clone();
            }
        }

        let id = self.next_col_id.fetch_add(1, Ordering::SeqCst);
        let col = ColumnDefinition {
            id,
            name: canonical_name.to_string(),
            physical_type: ptype,
        };
        cols.push(col.clone());
        name_map.insert(canonical_name.to_string(), id);
        col
    }
}

pub struct DynamicCatalog {
    tables: RwLock<HashMap<String, Arc<TableSchema>>>,
    synonyms: Arc<SynonymMap>,
}

impl Default for DynamicCatalog {
    fn default() -> Self {
        Self::new()
    }
}

impl DynamicCatalog {
    pub fn new() -> Self {
        Self {
            tables: RwLock::new(HashMap::new()),
            synonyms: Arc::new(SynonymMap::default()),
        }
    }

    pub fn with_synonyms(synonyms: Arc<SynonymMap>) -> Self {
        Self {
            tables: RwLock::new(HashMap::new()),
            synonyms,
        }
    }

    pub fn synonyms(&self) -> &Arc<SynonymMap> {
        &self.synonyms
    }

    pub fn get_or_create_table(&self, name: &str) -> Arc<TableSchema> {
        let table_key = name.trim().to_lowercase();
        {
            let tables = self.tables.read().unwrap();
            if let Some(t) = tables.get(&table_key) {
                return Arc::clone(t);
            }
        }
        let mut tables = self.tables.write().unwrap();
        tables
            .entry(table_key.clone())
            .or_insert_with(|| Arc::new(TableSchema::new(&table_key)))
            .clone()
    }

    pub fn get_table(&self, name: &str) -> Option<Arc<TableSchema>> {
        let table_key = name.trim().to_lowercase();
        self.tables.read().unwrap().get(&table_key).cloned()
    }

    pub fn all_tables(&self) -> Vec<String> {
        self.tables.read().unwrap().keys().cloned().collect()
    }

    /// Ingests a set of discovered field name/type pairs, resolving synonyms and evolving schema.
    pub fn evolve_schema(
        &self,
        table_name: &str,
        fields: &[(String, PhysicalType)],
    ) -> (Arc<TableSchema>, Vec<ColumnDefinition>) {
        let table = self.get_or_create_table(table_name);
        let mut resolved_cols = Vec::with_capacity(fields.len());

        for (field_name, ptype) in fields {
            let canonical_name = self.synonyms.resolve(field_name);
            let col_def = table.register_or_widen_column(&canonical_name, *ptype);
            resolved_cols.push(col_def);
        }

        (table, resolved_cols)
    }
}
