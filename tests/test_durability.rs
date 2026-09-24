use std::fs::OpenOptions;
use std::io::{Seek, SeekFrom, Write};
use synapse_wal::{
    recover_records, repair_wal_to_last_valid, WalConfig, WalError, WalRecord, WalWriter,
    WAL_HEADER_SIZE,
};
use tempfile::tempdir;

#[test]
fn test_durability_crash_recovery_500_records() {
    let dir = tempdir().unwrap();
    let wal_path = dir.path().join("active.wal");

    // -------------------------------------------------------------
    // Step 1: Initialize fresh WAL and append 500 sequential records
    // -------------------------------------------------------------
    let config = WalConfig {
        sync_on_write: true,
        buffer_capacity: 4096,
    };

    let wal = WalWriter::open(&wal_path, config).unwrap();

    for i in 1..=500 {
        let payload = format!(
            r#"{{"event_id": {}, "timestamp": 1710000000{}, "status": "CONFIRMED", "fare": {:.2}}}"#,
            i,
            i,
            20.0 + (i as f64) * 0.5
        );
        let row_id = wal.append(payload.as_bytes()).unwrap();
        assert_eq!(row_id, i, "RowID must increase monotonically");
    }

    // -------------------------------------------------------------
    // Step 2: Simulate crash / ungraceful shutdown
    // -------------------------------------------------------------
    // Ungraceful drop without explicit flush/close
    drop(wal);

    // -------------------------------------------------------------
    // Step 3: Reopen in recovery mode & verify 0 data loss
    // -------------------------------------------------------------
    let recovered = recover_records(&wal_path).expect("Recovery should succeed");
    assert_eq!(
        recovered.len(),
        500,
        "All 500 records must be recovered with zero data loss"
    );

    for (idx, record) in recovered.iter().enumerate() {
        let expected_id = (idx as u64) + 1;
        assert_eq!(record.row_id, expected_id, "Monotonic RowID mismatch");

        // Verify payload content
        let payload_str = std::str::from_utf8(&record.payload).unwrap();
        assert!(
            payload_str.contains(&format!(r#""event_id": {}"#, expected_id)),
            "Payload content mismatch on record {}",
            expected_id
        );

        // Verify CRC32 checksum validity
        let calculated_crc =
            WalRecord::calculate_crc32(record.timestamp_ns, record.row_id, &record.payload);
        assert_eq!(
            record.crc32, calculated_crc,
            "CRC32 mismatch on recovered record {}",
            expected_id
        );
    }

    // -------------------------------------------------------------
    // Step 4: Inject intentional bit-flip / corruption
    // -------------------------------------------------------------
    // Append an intentional corrupted record to the end of active.wal
    let mut wal_file = OpenOptions::new()
        .write(true)
        .open(&wal_path)
        .expect("Should open WAL for injecting corruption");

    // Create a 501st record but deliberately corrupt its payload bytes
    let corrupt_payload = b"{\"event_id\": 501, \"tampered\": true}".to_vec();
    let corrupt_record = WalRecord::new(1710000501000, 501, corrupt_payload);
    let mut record_bytes = Vec::new();
    corrupt_record.encode(&mut record_bytes).unwrap();

    // Flip bits in the payload section (after WAL_HEADER_SIZE)
    let payload_offset = WAL_HEADER_SIZE + 5;
    record_bytes[payload_offset] ^= 0xFF; // Bit-flip

    wal_file.seek(SeekFrom::End(0)).unwrap();
    wal_file.write_all(&record_bytes).unwrap();
    wal_file.sync_all().unwrap();
    drop(wal_file);

    // -------------------------------------------------------------
    // Step 5: Assert CRC failure halts corruption propagation
    // -------------------------------------------------------------
    let recovery_result = recover_records(&wal_path);
    match recovery_result {
        Err(WalError::CrcMismatch {
            row_id,
            expected,
            actual,
        }) => {
            assert_eq!(row_id, 501, "CRC mismatch must trigger on row 501");
            assert_ne!(
                expected, actual,
                "Expected CRC and actual CRC must differ on corrupt row"
            );
        }
        other => panic!(
            "Expected WalError::CrcMismatch on corrupt row, got: {:?}",
            other
        ),
    }

    // -------------------------------------------------------------
    // Step 6: Repair WAL to last valid boundary and verify safety
    // -------------------------------------------------------------
    let repaired_count = repair_wal_to_last_valid(&wal_path).expect("Repair must succeed");
    assert_eq!(
        repaired_count, 500,
        "Repaired WAL must restore exactly the 500 valid records"
    );

    // Reopen writer and ensure it cleanly continues sequence at 501
    let wal_resumed = WalWriter::open(&wal_path, config).expect("WAL should reopen cleanly");
    let next_id = wal_resumed
        .append(b"{\"event_id\": 501, \"resumed\": true}")
        .unwrap();
    assert_eq!(
        next_id, 501,
        "Monotonic RowID must resume cleanly after repair"
    );

    let final_recovered = recover_records(&wal_path).unwrap();
    assert_eq!(
        final_recovered.len(),
        501,
        "Final count must be 501 after resuming"
    );
}
