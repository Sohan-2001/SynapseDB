use crate::record::{WalError, WalRecord};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug)]
pub struct WalConfig {
    pub sync_on_write: bool,
    pub buffer_capacity: usize,
}

impl Default for WalConfig {
    fn default() -> Self {
        Self {
            sync_on_write: true,
            buffer_capacity: 64 * 1024, // 64KB buffer
        }
    }
}

pub struct WalWriter {
    path: PathBuf,
    writer: Mutex<BufWriter<File>>,
    next_row_id: AtomicU64,
    config: WalConfig,
}

impl WalWriter {
    pub fn open<P: AsRef<Path>>(path: P, config: WalConfig) -> Result<Arc<Self>, WalError> {
        let path_buf = path.as_ref().to_path_buf();
        if let Some(parent) = path_buf.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&path_buf)?;

        // Determine starting row_id by recovering existing log if present
        let highest_row_id = crate::recovery::get_highest_row_id(&path_buf)?;
        let start_row_id = highest_row_id.map(|id| id + 1).unwrap_or(1);

        let writer = BufWriter::with_capacity(config.buffer_capacity, file);

        Ok(Arc::new(Self {
            path: path_buf,
            writer: Mutex::new(writer),
            next_row_id: AtomicU64::new(start_row_id),
            config,
        }))
    }

    /// Appends a raw byte payload to the WAL, ensures on-disk persistence,
    /// and returns the assigned 64-bit monotonically increasing RowID.
    pub fn append(&self, payload: &[u8]) -> Result<u64, WalError> {
        let row_id = self.next_row_id.fetch_add(1, Ordering::SeqCst);
        let timestamp_ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as i64)
            .unwrap_or(0);

        let record = WalRecord::new(timestamp_ns, row_id, payload.to_vec());

        {
            let mut writer = self.writer.lock().unwrap();
            record.encode(&mut *writer)?;

            if self.config.sync_on_write {
                writer.flush()?;
                writer.get_ref().sync_data()?;
            }
        }

        Ok(row_id)
    }

    /// Flush any buffered records to disk and fsync.
    pub fn flush_and_sync(&self) -> Result<(), WalError> {
        let mut writer = self.writer.lock().unwrap();
        writer.flush()?;
        writer.get_ref().sync_data()?;
        Ok(())
    }

    pub fn current_row_id(&self) -> u64 {
        self.next_row_id.load(Ordering::Relaxed)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}
