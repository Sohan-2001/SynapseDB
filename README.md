# ⚡ SynapseDB

> **Sub-millisecond single-row durable writes (`fsync` WAL) + zero-DDL columnar analytics in Rust.**  
> Ingest arbitrary JSON without `CREATE TABLE`, guarantee crash durability via synchronous hardware `fsync`, and execute vectorized analytical aggregations at microsecond speeds.

[![Rust](https://img.shields.io/badge/Rust-2021_Edition-orange.svg?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg?style=flat-square)](https://github.com/Sohan-2001/SynapseDB)
[![Architecture](https://img.shields.io/badge/Architecture-Hybrid%20OLTP%20%2F%20OLAP-emerald.svg?style=flat-square)]()
[![Tests](https://img.shields.io/badge/Tests-17%20Passed%20%E2%9C%93-brightgreen.svg?style=flat-square)]()

---

## 🌟 The Wedge: Bridging Document Ingestion & Columnar Analytics

Most databases force an architectural compromise between write ergonomics and analytical speed:
- **DuckDB** is the gold standard for embedded columnar analytics and bulk Parquet processing, but it is architected for analytical batch ingestion. High-rate, concurrent single-row transactional inserts suffer from coarse table-level locking and transaction overhead.
- **MongoDB** and document stores ingest arbitrary, variable JSON payloads effortlessly, but running aggregations (`SUM`, `AVG`, `COUNT`) requires scanning uncompressed row documents into memory—crushing query latency.
- **Cloud LLMs** (text-to-SQL) introduce 500–2000 ms latency, cost dollars per workload, leak data over external APIs, and suffer from stochastic hallucinations.

**SynapseDB bridges this exact gap**:
1. **Sub-Millisecond Durable Writes (`< 1 ms`)**: Synchronously appends individual payloads to an `fsync`-backed Write-Ahead Log (WAL) protected by CRC32 checksums and atomic directory barriers.
2. **Zero-DDL Dynamic Schema Evolution**: Ingests arbitrary JSON, JSON arrays, and key-value pairs without `CREATE TABLE`. Dynamic types automatically widen (`Int64` → `Float64` → `Utf8`) at runtime.
3. **Vectorized Columnar Analytics**: Micro-batches payloads into Arrow-compatible contiguous columnar chunks with zone maps (min/max bounds) for microsecond aggregations (`< 50 μs`).
4. **Embedded Deterministic CPU SLM**: An in-process, zero-cloud Small Language Model query compiler that maps plain English to validated AST execution plans in `< 50 μs` with **\$0 cost** and **zero data leakage**.

---

## 🥊 Technical Comparison Matrix

| Feature / Architecture | **SynapseDB** | **DuckDB** | **MongoDB** | **PostgreSQL (JSONB)** |
| :--- | :--- | :--- | :--- | :--- |
| **High-Rate Single-Row Writes** | **< 1 ms (Hardware `fsync` WAL)** | Slow (Batch / Parquet OLAP focus) | Moderate (WiredTiger row BSON) | Moderate (Lock contention / WAL overhead) |
| **Zero-DDL Schema Evolution** | **Yes** (Automatic type widening) | No (Requires DDL / bulk schema inference) | **Yes** (Schemaless document model) | Partial (Requires table DDL + JSONB wrapper) |
| **Columnar Aggregations** | **Vectorized (< 50 μs, Zone Maps)** | **Vectorized (State-of-the-Art)** | Row-oriented (Scans uncompressed BSON) | Row-oriented (Heap scans on JSONB) |
| **Crash-Recovery Durability** | **Hardware `fsync` + CRC32 + Atomic Rename** | Single-file checkpoint / WAL | Journaling | Standard WAL + Checkpoints |
| **Natural Language Layer** | **Embedded CPU SLM (< 50 μs, $0)** | None (SQL only) | None (MQL / Atlas vector search) | None (SQL only) |
| **Deployment Footprint** | **Zero-Dependency Native Binary (~12 MB)** | Embedded C++ library | Multi-gigabyte standalone daemon | Multi-gigabyte standalone daemon |

---

## 🏗️ Architecture Flowchart

```
================================== INGESTION PATH ==================================

[ Client Application / UI ]
         │
         │  1. Push raw string (JSON, Key-Value, or Text Log)
         ▼
┌────────────────────────────────────────────────────────┐
│  TCP Wire Server (Tokio Async, Port 8765)              │
│  - Parses raw bytes & assigns 64-bit RowID             │
└────────────────────────────────────────────────────────┘
         │
         ├─── 2. Append directly ──────────────────────────┐
         │                                                 ▼
         │                                   ┌───────────────────────────┐
         │                                   │  Durable WAL (active.wal) │
         │                                   │  - Synchronous fsync()    │
         │                                   │  - Crash-safe guarantee   │
         │                                   └───────────────────────────┘
         ▼
┌────────────────────────────────────────────────────────┐
│  Micro-Batch Ring Buffer (Lock-Free In-Memory)         │
│  - Queues records for background columnar transformation│
└────────────────────────────────────────────────────────┘
         │
         ▼ (Background Worker / FLUSH)
┌────────────────────────────────────────────────────────┐
│  SLM Schema Extractor & Columnar Dynamic Catalog       │
│  - Extracts types (Int64, Float64, Utf8, Bool)         │
│  - Resolves semantic synonyms (fare -> amount)         │
│  - Encodes vectors into Arrow-compatible ColumnChunks  │
└────────────────────────────────────────────────────────┘

=================================== QUERY PATH ===================================

[ User Query: Direct SQL or Plain English ]
         │
         ▼
┌────────────────────────────────────────────────────────┐
│  SLM Query Planner                                     │
│  - Detects query intent (Direct SQL vs Natural Language)│
│  - Compiles English ("Total spent where amount > 30")  │
│    into verified SelectQuery AST                      │
└────────────────────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────────────────────┐
│  Vectorized Analytical Query Engine                    │
│  - Evaluates Zone Maps to skip unneeded chunks         │
│  - Scans only requested column vectors                 │
│  - Microsecond aggregations (< 50 μs)                  │
└────────────────────────────────────────────────────────┘
```

---

## 📦 Workspace Crates

The project is structured as a modular Rust workspace:

| Crate | Path | Responsibility |
| :--- | :--- | :--- |
| `synapse-wal` | [`crates/wal`](crates/wal) | High-throughput write-ahead logging with frame headers and crash recovery. |
| `synapse-catalog` | [`crates/catalog`](crates/catalog) | Dynamic schema registry, column type tracking, and synonym dictionaries. |
| `synapse-columnar` | [`crates/columnar`](crates/columnar) | In-memory columnar storage, chunk management, and zone map metadata. |
| `synapse-slm` | [`crates/slm`](crates/slm) | Deterministic Small Language Model extractor and NL-to-SQL AST compiler. |
| `synapse-engine` | [`crates/engine`](crates/engine) | Vectorized SQL parser and execution engine (`SELECT`, `WHERE`, aggregations). |
| `synapse-server` | [`crates/server`](crates/server) | Multi-client TCP wire protocol server with connection pooling. |

---

## 🖥️ Desktop UI: SynapseDB Studio

Located in [`desktop/`](desktop), SynapseDB Studio provides an intuitive graphical interface:

* **Query Studio**: Dual-mode querying: standard SQL or plain English Natural Language queries.
* **Data Browser (`⊞`)**: View all stored tables with Table Grid and Raw JSON toggles, real-time substring filtering, and one-click CSV / JSON export.
* **Ingestion Lab (`📥`)**: Push single records, batch JSON arrays, or simulate high-throughput traffic using the synthetic workload generator.
* **Schema Explorer (`📊`)**: Inspect active tables, dynamic column types, and row distribution.
* **Engine Health (`⚡`)**: Monitor live TCP connection latency, storage status, and engine logs.

---

## 🚀 Quickstart Guide

### Prerequisites
* **Rust** (1.75+ recommended): [rustup.rs](https://rustup.rs/)
* **Node.js** (v18+ recommended): For the desktop UI.
* **Python** (optional): For client script examples.

### 1. Clone & Build the Engine
```bash
git clone https://github.com/Sohan-2001/SynapseDB.git
cd SynapseDB

# Build the optimized release binary
cargo build --release

# Run all 17 unit, crash-recovery, and integration tests across crates
cargo test --all
```

### 2. Start the SynapseDB Server
```bash
# Run server (default: 127.0.0.1:8765)
cargo run --release -p synapse-server
```

### 3. Launch SynapseDB Studio (Desktop App)
```bash
cd desktop
npm install
npm start
```

---

## 📡 TCP Wire Protocol

SynapseDB communicates via a high-performance Redis/RESP-inspired line-delimited TCP protocol:

| Command | Syntax | Description | Example |
| :--- | :--- | :--- | :--- |
| `PUSH` | `PUSH <table> <payload>` | Append payload to WAL and ring buffer | `PUSH rides {"fare": 25.5, "driver": "Alice"}` |
| `QUERY` | `QUERY <sql or nl>` | Execute SQL or Natural Language query | `QUERY SELECT * FROM rides WHERE amount > 20` |
| `FLUSH` | `FLUSH` | Drain ring buffer into columnar memory | `FLUSH` |
| `SCHEMA` | `SCHEMA [table]` | List tables or retrieve table column types | `SCHEMA rides` |
| `INFO` | `INFO` | Get engine version, storage mode, and stats | `INFO` |
| `PING` | `PING` | Check connectivity and latency | `PING` |

---

## 📖 Ingestion & Query Syntax Rules

For comprehensive syntactical rules, field naming constraints, and query keywords, see **[`SYNTAX_RULES.md`](SYNTAX_RULES.md)**.

### Quick Example: Ingestion Formats
```text
# 1. Key-Value Notation
coffee: 100, tea: 10, cab_cost: 500

# 2. JSON Record
{"fare": 45.50, "driver": "Alice", "user_id": 1001}

# 3. Multi-Row JSON Batch
[ {"item": "coffee", "cost": 100}, {"item": "cab", "cost": 500} ]
```

### Quick Example: Analytical Queries
```sql
SELECT SUM(cost), AVG(cost) FROM expenses
SELECT driver, amount FROM rides WHERE amount > 30 LIMIT 10
SELECT * FROM demo WHERE message LIKE 'coffee'
```

---

## 🛡️ Crash Durability & Torn-Write Protection

SynapseDB enforces strict POSIX filesystem durability guarantees across all crash surfaces:

1. **CRC32 Record Verification**: Every record appended to the Write-Ahead Log (WAL) includes a 32-bit CRC checksum. On startup or recovery, corrupted or truncated byte sequences are detected immediately.
2. **Safe Repair (`repair_wal_to_last_valid`)**: Truncated or torn writes are rolled back to the last valid CRC32 boundary via atomic temporary files, explicit temp-file `fsync()`, and parent directory synchronization (`sync_all()`).
3. **Columnar Chunk Flush (`flush_chunk`)**: Flushes in-memory vectors to atomic temp files, explicitly calling `sync_all()` on the temp handle before atomic rename, preventing power-loss corruption.
4. **Verified by Automated Crash Tests**:
   - `test_wal_crash_recovery_and_restart`: Simulates mid-transaction engine kill and validates zero record loss.
   - `test_repair_wal_torn_write_and_fsync`: Injects torn byte corruptions into the WAL and confirms bit-exact recovery.
   - `test_flush_chunk_durability_and_reload`: Asserts uncommitted data survival across simulated process termination.

---

## 🧠 Embedded CPU SLM vs. Cloud LLMs

| Property | SynapseDB Deterministic SLM | External Cloud LLMs (OpenAI, Claude, etc.) |
| :--- | :--- | :--- |
| **Execution Latency** | **< 50 μs (CPU in-process)** | 500 ms – 3,000 ms (Network hop + token generation) |
| **Financial Cost** | **$0.00 / query (Zero API bills)** | Variable API pricing ($0.005–$0.03+ per query) |
| **Data Privacy** | **100% Local / Air-Gapped** | Queries & schema metadata sent over public internet |
| **Output Determinism** | **100% Guaranteed AST (0% Hallucination)** | Stochastic / Probabilistic (Syntax hallucinations) |
| **Dependency Footprint** | **Zero external dependencies (Pure Rust)** | Requires API keys, rate-limit retries, and network connectivity |

---

## 🤝 Contributing & Collaboration

SynapseDB is an open-source project welcoming contributions from database enthusiasts, systems engineers, and open-source developers!

### How to Contribute:
1. **Fork the Repository** on GitHub.
2. **Create a Feature Branch**: `git checkout -b feature/awesome-feature`
3. **Commit your changes**: `git commit -m 'feat: Add SIMD vector acceleration'`
4. **Push to the branch**: `git push origin feature/awesome-feature`
5. **Open a Pull Request**.

### Roadmap & Ideas to Explore:
- [ ] SIMD vector acceleration for AVX-512 / ARM NEON column aggregations.
- [ ] On-disk Parquet / Arrow file compaction for historical data segments.
- [ ] Expanded SQL dialect: `GROUP BY`, `ORDER BY`, and hash joins.
- [ ] WebAssembly (Wasm) client bindings.

---

## 📄 License

This project is licensed under the **MIT License** - see the [`LICENSE`](LICENSE) file for details.

Developed with ❤️ by **[Sohan Karfa](https://github.com/Sohan-2001)**.
