use crate::record::{WalError, WalRecord};
use std::fs::{File, OpenOptions};
use std::io::BufReader;
use std::path::Path;

pub fn recover_records<P: AsRef<Path>>(path: P) -> Result<Vec<WalRecord>, WalError> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(Vec::new());
    }

    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut records = Vec::new();

    loop {
        match WalRecord::decode(&mut reader) {
            Ok(Some(record)) => records.push(record),
            Ok(None) => break,
            Err(WalError::UnexpectedEof) => {
                // Incomplete write at end of WAL (torn write) - stop reading valid prefix
                break;
            }
            Err(e) => return Err(e),
        }
    }

    Ok(records)
}

pub fn get_highest_row_id<P: AsRef<Path>>(path: P) -> Result<Option<u64>, WalError> {
    let records = recover_records(path)?;
    Ok(records.last().map(|r| r.row_id))
}

/// Truncate any corrupt/torn write at the end of the log to restore cleanly.
pub fn repair_wal_to_last_valid<P: AsRef<Path>>(path: P) -> Result<usize, WalError> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(0);
    }

    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut records = Vec::new();

    loop {
        match WalRecord::decode(&mut reader) {
            Ok(Some(record)) => records.push(record),
            Ok(None) => break,
            Err(WalError::Io(e)) => return Err(WalError::Io(e)),
            Err(_) => {
                // Incomplete write, CRC mismatch, or corrupt header at the end of WAL.
                // Stop at the last valid record to repair the log.
                break;
            }
        }
    }

    let count = records.len();

    // Re-write clean records to temporary file and atomically replace
    let temp_path = path.with_extension("repaired.tmp");
    {
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&temp_path)?;
        let mut writer = std::io::BufWriter::new(file);
        for record in &records {
            record.encode(&mut writer)?;
        }
        use std::io::Write;
        writer.flush()?;
        let file = writer.into_inner().map_err(|e| e.into_error())?;
        file.sync_all()?;
    }

    std::fs::rename(&temp_path, path)?;

    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        if let Ok(dir) = std::fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }

    Ok(count)
}
