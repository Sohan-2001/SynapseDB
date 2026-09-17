use crate::extractor::{ExtractedRecord, SchemaExtractor};
use crossbeam_channel::{bounded, Sender};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use synapse_catalog::DynamicCatalog;
use synapse_columnar::TableMemTable;

pub struct RawRecord {
    pub row_id: u64,
    pub table_name: String,
    pub payload: Vec<u8>,
}

pub struct MicroBatchingCoordinator {
    sender: Sender<RawRecord>,
    is_running: Arc<AtomicBool>,
    in_flight: Arc<std::sync::atomic::AtomicUsize>,
    worker_handles: Vec<JoinHandle<()>>,
}

impl MicroBatchingCoordinator {
    pub fn new(
        catalog: Arc<DynamicCatalog>,
        memtables: Arc<RwLock<HashMap<String, Arc<TableMemTable>>>>,
        worker_threads: usize,
        batch_size: usize,
        batch_timeout_ms: u64,
    ) -> Self {
        // High-capacity channel acting as lock-free ring buffer
        let (sender, receiver) = bounded::<RawRecord>(10_000);
        let is_running = Arc::new(AtomicBool::new(true));
        let in_flight = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut worker_handles = Vec::new();

        for _ in 0..worker_threads {
            let rx = receiver.clone();
            let running = Arc::clone(&is_running);
            let cat = Arc::clone(&catalog);
            let mts = Arc::clone(&memtables);
            let inflight = Arc::clone(&in_flight);

            let handle = thread::spawn(move || {
                let extractor = SchemaExtractor::new();
                let mut batch = Vec::with_capacity(batch_size);
                let timeout = Duration::from_millis(batch_timeout_ms);

                while running.load(Ordering::Relaxed) || !rx.is_empty() {
                    let start = Instant::now();

                    // Accumulate batch of 8-32 records or until 20ms timeout
                    while batch.len() < batch_size && start.elapsed() < timeout {
                        let remaining = timeout.saturating_sub(start.elapsed());
                        match rx.recv_timeout(remaining) {
                            Ok(rec) => batch.push(rec),
                            Err(_) => break, // Timeout reached
                        }
                    }

                    if batch.is_empty() {
                        continue;
                    }

                    let batch_len = batch.len();

                    // Process batch
                    let mut extracted_records = Vec::with_capacity(batch_len);
                    for item in batch.drain(..) {
                        let text = String::from_utf8_lossy(&item.payload);
                        let extracted = extractor.extract(item.row_id, &item.table_name, &text);
                        extracted_records.push(extracted);
                    }

                    // Group by table
                    let mut by_table: HashMap<String, Vec<ExtractedRecord>> = HashMap::new();
                    for rec in extracted_records {
                        by_table.entry(rec.table_name.clone()).or_default().push(rec);
                    }

                    for (table_name, records) in by_table {
                        // Discover fields and evolve catalog schema
                        for rec in &records {
                            let field_defs: Vec<_> = rec
                                .fields
                                .iter()
                                .filter_map(|(k, v)| v.physical_type().map(|pt| (k.clone(), pt)))
                                .collect();

                            let (table_schema, _resolved_cols) =
                                cat.evolve_schema(&table_name, &field_defs);

                            // Get or create memtable
                            let memtable = {
                                let mut map = mts.write().unwrap();
                                map.entry(table_name.clone())
                                    .or_insert_with(|| {
                                        Arc::new(TableMemTable::new(&table_name, 65536, None))
                                    })
                                    .clone()
                            };

                            // Map values to column IDs
                            let mut row_values = Vec::with_capacity(rec.fields.len());
                            for (fname, val) in &rec.fields {
                                let canonical = cat.synonyms().resolve(fname);
                                if let Some(col_def) = table_schema.get_column_by_name(&canonical) {
                                    row_values.push((col_def.id, col_def.physical_type, val.clone()));
                                }
                            }

                            let _ = memtable.insert_row(&row_values);
                        }
                    }

                    // Decrement in-flight count now that records are safely in MemTable
                    inflight.fetch_sub(batch_len, Ordering::SeqCst);
                }
            });

            worker_handles.push(handle);
        }

        Self {
            sender,
            is_running,
            in_flight,
            worker_handles,
        }
    }

    pub fn push_record(&self, record: RawRecord) -> Result<(), String> {
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        self.sender
            .try_send(record)
            .map_err(|e| {
                self.in_flight.fetch_sub(1, Ordering::SeqCst);
                format!("Ingestion buffer full: {}", e)
            })
    }

    pub fn wait_for_drain(&self, max_wait: Duration) {
        let start = Instant::now();
        while self.in_flight.load(Ordering::SeqCst) > 0 && start.elapsed() < max_wait {
            thread::sleep(Duration::from_millis(1));
        }
    }

    pub fn shutdown(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        for handle in self.worker_handles.drain(..) {
            let _ = handle.join();
        }
    }
}

impl Drop for MicroBatchingCoordinator {
    fn drop(&mut self) {
        self.shutdown();
    }
}
