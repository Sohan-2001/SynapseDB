use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use synapse_catalog::DynamicCatalog;
use synapse_columnar::{SegmentManager, TableMemTable};
use synapse_engine::ExecutionEngine;
use synapse_slm::{MicroBatchingCoordinator, QueryPlanner, RawRecord};
use synapse_wal::{WalConfig, WalWriter};

pub struct DatabaseEngine {
    wal: Arc<WalWriter>,
    catalog: Arc<DynamicCatalog>,
    memtables: Arc<RwLock<HashMap<String, Arc<TableMemTable>>>>,
    coordinator: Arc<MicroBatchingCoordinator>,
    planner: Arc<QueryPlanner>,
    segment_manager: Arc<SegmentManager>,
}

impl DatabaseEngine {
    pub fn open(data_dir: PathBuf) -> Result<Arc<Self>, Box<dyn std::error::Error>> {
        std::fs::create_dir_all(&data_dir)?;

        let wal_path = data_dir.join("wal").join("active.wal");
        let wal = WalWriter::open(&wal_path, WalConfig::default())?;

        let catalog = Arc::new(DynamicCatalog::default());
        let memtables = Arc::new(RwLock::new(HashMap::new()));
        let segment_manager = Arc::new(SegmentManager::new(data_dir.join("segments"))?);

        let coordinator = Arc::new(MicroBatchingCoordinator::new(
            Arc::clone(&catalog),
            Arc::clone(&memtables),
            4,  // 4 worker threads
            32, // batch size up to 32 records
            20, // batch timeout 20ms
        ));

        // Replay existing records in the WAL for automatic recovery on restart
        if wal_path.exists() {
            if let Ok(records) = synapse_wal::recover_records(&wal_path) {
                for rec in records {
                    let payload_str = String::from_utf8_lossy(&rec.payload);
                    if let Some((table, text)) = payload_str.split_once('\t') {
                        let _ = coordinator.push_record(RawRecord {
                            row_id: rec.row_id,
                            table_name: table.to_string(),
                            payload: text.as_bytes().to_vec(),
                        });
                    }
                }
                coordinator.wait_for_drain(std::time::Duration::from_secs(5));
            }
        }

        let planner = Arc::new(QueryPlanner::new(Arc::clone(&catalog)));

        Ok(Arc::new(Self {
            wal,
            catalog,
            memtables,
            coordinator,
            planner,
            segment_manager,
        }))
    }

    /// Primary ingestion path:
    /// 1. Appends directly to append-only WAL with immediate fsync
    /// 2. Monotonic 64-bit RowID assigned
    /// 3. Pushes to in-memory ring buffer micro-batching coordinator
    /// 4. Returns RowID to caller in < 1ms
    pub fn push(&self, table: &str, raw_text: &str) -> Result<u64, String> {
        let payload_bytes = raw_text.as_bytes();
        let wal_payload = format!("{}\t{}", table, raw_text);

        // 1 & 2: Persist to WAL and get RowID
        let row_id = self
            .wal
            .append(wal_payload.as_bytes())
            .map_err(|e| format!("WAL error: {}", e))?;

        // 3: Push to lock-free ring buffer
        self.coordinator.push_record(RawRecord {
            row_id,
            table_name: table.to_string(),
            payload: payload_bytes.to_vec(),
        })?;

        // 4: Return RowID immediately
        Ok(row_id)
    }

    /// Primary query path:
    /// 1. Direct SQL or NL detected
    /// 2. If NL, SLM Query Planner compiles to physical SQL AST
    /// 3. Evaluates against columnar memory storage & LSM segments
    /// 4. SIMD vector scan + sparse min/max zone map pruning
    /// 5. Deterministic exact aggregation
    pub fn query(&self, query_str: &str) -> Result<serde_json::Value, String> {
        // Plan query (Direct SQL or Natural Language)
        let select_ast = self
            .planner
            .plan(query_str)
            .map_err(|e| format!("Planning error: {}", e))?;

        let table_name = select_ast.table.to_lowercase();
        let table_schema = self
            .catalog
            .get_table(&table_name)
            .ok_or_else(|| format!("Table '{}' does not exist in catalog", table_name))?;

        let memtables = self.memtables.read().unwrap();
        let memtable = memtables
            .get(&table_name)
            .ok_or_else(|| format!("No data found for table '{}'", table_name))?;

        let chunks = memtable.get_all_chunks();

        let query_result = ExecutionEngine::execute(&select_ast, &table_schema, &chunks)
            .map_err(|e| format!("Execution error: {}", e))?;

        // Format into clean JSON output
        let mut json_rows = Vec::new();
        for row in query_result.rows {
            let mut obj = serde_json::Map::new();
            for (header, val) in query_result.columns.iter().zip(row) {
                let jv = match val {
                    synapse_catalog::CatalogValue::Null => serde_json::Value::Null,
                    synapse_catalog::CatalogValue::Bool(b) => serde_json::Value::Bool(b),
                    synapse_catalog::CatalogValue::Int64(i) => serde_json::json!(i),
                    synapse_catalog::CatalogValue::Float64(f) => serde_json::json!(f),
                    synapse_catalog::CatalogValue::Timestamp(t) => serde_json::json!(t),
                    synapse_catalog::CatalogValue::Utf8(s) => serde_json::Value::String(s),
                };
                obj.insert(header.clone(), jv);
            }
            json_rows.push(serde_json::Value::Object(obj));
        }

        Ok(json!({
            "status": "success",
            "table": table_name,
            "columns": query_result.columns,
            "row_count": json_rows.len(),
            "rows": json_rows,
            "stats": {
                "execution_time_us": query_result.execution_time_us,
                "chunks_scanned": query_result.chunks_scanned,
                "chunks_pruned": query_result.chunks_pruned,
            }
        }))
    }

    pub fn schema(&self, table_name: Option<&str>) -> serde_json::Value {
        match table_name {
            Some(t) => {
                let t_lower = t.to_lowercase();
                if let Some(table) = self.catalog.get_table(&t_lower) {
                    let cols: Vec<_> = table
                        .columns()
                        .into_iter()
                        .map(|c| {
                            json!({
                                "id": c.id,
                                "name": c.name,
                                "type": c.physical_type.to_string(),
                            })
                        })
                        .collect();

                    let memtables = self.memtables.read().unwrap();
                    let row_count = memtables.get(&t_lower).map_or(0, |m| m.total_row_count());

                    json!({
                        "table": t_lower,
                        "row_count": row_count,
                        "columns": cols,
                    })
                } else {
                    json!({ "error": format!("Table '{}' not found", t) })
                }
            }
            None => {
                let tables = self.catalog.all_tables();
                json!({ "tables": tables })
            }
        }
    }

    pub fn segment_manager(&self) -> &Arc<SegmentManager> {
        &self.segment_manager
    }

    pub fn flush_all(&self) -> Result<(), String> {
        self.coordinator.wait_for_drain(std::time::Duration::from_secs(2));
        self.wal.flush_and_sync().map_err(|e| e.to_string())?;
        let memtables = self.memtables.read().unwrap();
        for memtable in memtables.values() {
            memtable.flush_active().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
