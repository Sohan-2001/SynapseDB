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
    let records = recover_records(&path)?;
    let count = records.len();

    // Re-write clean records to temporary file and atomically replace
    let temp_path = path.as_ref().with_extension("repaired.tmp");
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
    }

    std::fs::rename(temp_path, path)?;
    Ok(count)
}
