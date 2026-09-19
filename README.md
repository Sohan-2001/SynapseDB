# ⚡ SynapseDB

> **A sub-millisecond, zero-DDL hybrid database engine built in Rust with local SLM query compilation and vectorized columnar analytics.**

[![Rust](https://img.shields.io/badge/Rust-2021_Edition-orange.svg?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg?style=flat-square)](https://github.com/Sohan-2001/SynapseDB)
[![Architecture](https://img.shields.io/badge/Architecture-Hybrid%20OLTP%20%2F%20OLAP-emerald.svg?style=flat-square)]()

---

## 🌟 Overview

Traditional relational databases require rigid, pre-defined schemas (`CREATE TABLE`) before ingesting a single byte. Document databases offer schema flexibility but suffer from slow scans and high memory footprints during analytical queries. Large Language Model (LLM) database interfaces are too slow (hundreds of milliseconds) and expensive for real-time transactional systems.

**SynapseDB** bridges this gap:
1. **Sub-Millisecond Durable Writes (`< 1 ms`)**: Synchronously appends raw payloads to an `fsync`-backed Write-Ahead Log (WAL).
2. **Zero-DDL Dynamic Schema Evolution**: Automatically parses JSON objects, multi-record JSON arrays, and key-value pairs into typed columnar tables without prior table definition.
3. **CPU-Hosted Small Language Model (SLM)**: An ultra-fast, zero-cloud deterministic NLP query planner that compiles plain English into verified AST execution plans in microseconds.
4. **Vectorized Columnar Storage & Zone Maps**: Compresses data into columnar vectors with chunk-level min/max pruning for blazing-fast aggregations (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`).
5. **Modern Desktop Studio**: Includes a desktop GUI ("SynapseDB Studio") built with Electron for live querying, data browsing, table management, and workload benchmarking.

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

# Run all 12 unit and integration tests across crates
cargo test
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
