use std::thread;
use std::time::Duration;
use synapse_server::DatabaseEngine;
use tempfile::tempdir;

#[test]
fn test_end_to_end_synapsedb() {
    let dir = tempdir().unwrap();
    let engine = DatabaseEngine::open(dir.path().to_path_buf()).unwrap();

    // 1. Ingest JSON and messy logs
    let id1 = engine
        .push("taxi", r#"{"fare": 20.0, "user_id": 101}"#)
        .unwrap();
    let id2 = engine
        .push("taxi", r#"{"fare": 40.0, "user_id": 102}"#)
        .unwrap();
    let id3 = engine
        .push("taxi", r#"{"cost": 60.0, "user_id": 103}"#)
        .unwrap();
    let id4 = engine
        .push("taxi", "Driver John completed ride for user_id=104 fare=80.0")
        .unwrap();

    // Verify monotonic IDs
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id3, 3);
    assert_eq!(id4, 4);

    // Wait for micro-batching ring buffer (20ms timeout) to drain and ingest into columnar memory
    thread::sleep(Duration::from_millis(100));

    // 2. Query via direct SQL
    let sql_res = engine
        .query("SELECT SUM(amount), COUNT(*) FROM taxi WHERE amount > 30")
        .unwrap();

    let sql_rows = sql_res["rows"].as_array().unwrap();
    assert_eq!(sql_rows.len(), 1);
    let row = &sql_rows[0];

    // Amounts > 30 are: 40.0, 60.0, 80.0 -> Sum = 180.0, Count = 3
    assert_eq!(row["SUM(amount)"], 180.0);
    assert_eq!(row["COUNT(*)"], 3);

    // 3. Query via Natural Language: "Total taxi spent where amount > 30"
    let nl_res = engine
        .query("Total taxi spent where amount > 30")
        .unwrap();

    let nl_rows = nl_res["rows"].as_array().unwrap();
    assert_eq!(nl_rows.len(), 1);
    assert_eq!(nl_rows[0]["SUM(amount)"], 180.0);

    // 4. Inspect schema
    let schema_res = engine.schema(Some("taxi"));
    assert_eq!(schema_res["table"], "taxi");
    assert_eq!(schema_res["row_count"], 4);
}

#[test]
fn test_wal_crash_recovery_and_restart() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().to_path_buf();

    // Session 1: Write records
    {
        let engine = DatabaseEngine::open(db_path.clone()).unwrap();
        let id1 = engine.push("orders", r#"{"fare": 50.0, "customer": "Alice"}"#).unwrap();
        let id2 = engine.push("orders", r#"{"amount": 100.0, "customer": "Bob"}"#).unwrap();
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        engine.flush_all().unwrap();
    } // engine is dropped here (simulating restart)

    // Session 2: Re-open from disk and verify full state recovery
    {
        let engine = DatabaseEngine::open(db_path).unwrap();

        // Verify schema and restored row count
        let schema = engine.schema(Some("orders"));
        assert_eq!(schema["table"], "orders");
        assert_eq!(schema["row_count"], 2);

        // Verify exact queries work on recovered state
        let res = engine.query("SELECT COUNT(*), SUM(amount) FROM orders").unwrap();
        let row = &res["rows"].as_array().unwrap()[0];
        assert_eq!(row["COUNT(*)"], 2);
        assert_eq!(row["SUM(amount)"], 150.0);

        // Verify row IDs continue monotonically from 3
        let id3 = engine.push("orders", r#"{"cost": 25.0, "customer": "Charlie"}"#).unwrap();
        assert_eq!(id3, 3);
    }
}
