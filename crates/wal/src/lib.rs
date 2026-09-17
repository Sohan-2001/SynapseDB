pub mod record;
pub mod recovery;
pub mod wal;

pub use record::{WalError, WalRecord, WAL_HEADER_SIZE};
pub use recovery::{get_highest_row_id, recover_records, repair_wal_to_last_valid};
pub use wal::{WalConfig, WalWriter};

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use tempfile::tempdir;

    #[test]
    fn test_record_crc32_and_roundtrip() {
        let payload = b"{\"user_id\": 42, \"amount\": 129.50}".to_vec();
        let record = WalRecord::new(1700000000_000, 1, payload);

        let mut buf = Vec::new();
        record.encode(&mut buf).unwrap();

        assert_eq!(buf.len(), WAL_HEADER_SIZE + record.payload.len());

        let mut slice = &buf[..];
        let decoded = WalRecord::decode(&mut slice).unwrap().unwrap();
        assert_eq!(decoded, record);
    }

    #[test]
    fn test_wal_append_and_recovery() {
        let dir = tempdir().unwrap();
        let wal_path = dir.path().join("test.wal");

        let wal = WalWriter::open(&wal_path, WalConfig::default()).unwrap();

        let id1 = wal.append(b"record-1").unwrap();
        let id2 = wal.append(b"record-2").unwrap();
        let id3 = wal.append(b"record-3").unwrap();

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
        drop(wal);

        // Reopen and recover
        let recovered = recover_records(&wal_path).unwrap();
        assert_eq!(recovered.len(), 3);
        assert_eq!(recovered[0].payload, b"record-1");
        assert_eq!(recovered[1].payload, b"record-2");
        assert_eq!(recovered[2].payload, b"record-3");

        // Open again and verify continuation of row_id
        let wal2 = WalWriter::open(&wal_path, WalConfig::default()).unwrap();
        let id4 = wal2.append(b"record-4").unwrap();
        assert_eq!(id4, 4);
    }

    #[test]
    fn test_concurrent_wal_appends() {
        let dir = tempdir().unwrap();
        let wal_path = dir.path().join("concurrent.wal");
        let wal = WalWriter::open(&wal_path, WalConfig::default()).unwrap();

        let mut handles = Vec::new();
        for t in 0..8 {
            let wal_clone = Arc::clone(&wal);
            handles.push(thread::spawn(move || {
                for i in 0..100 {
                    let msg = format!("thread-{}-msg-{}", t, i);
                    wal_clone.append(msg.as_bytes()).unwrap();
                }
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        drop(wal);

        let recovered = recover_records(&wal_path).unwrap();
        assert_eq!(recovered.len(), 800);

        // Verify all row_ids are unique and cover 1..=800
        let mut row_ids: Vec<u64> = recovered.iter().map(|r| r.row_id).collect();
        row_ids.sort_unstable();
        for (i, &id) in row_ids.iter().enumerate() {
            assert_eq!(id, (i as u64) + 1);
        }
    }
}
