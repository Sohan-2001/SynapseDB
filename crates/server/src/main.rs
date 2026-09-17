pub mod db;
pub mod protocol;

use db::DatabaseEngine;
use protocol::{Command, ProtocolParser};
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tracing::{error, info};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let bind_addr = env::var("SYNAPSE_ADDR").unwrap_or_else(|_| "127.0.0.1:8765".to_string());
    let data_dir = env::var("SYNAPSE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./data"));

    info!("Initializing SynapseDB Engine at {:?}", data_dir);
    let engine = DatabaseEngine::open(data_dir)?;

    let listener = TcpListener::bind(&bind_addr).await?;
    info!("=======================================================");
    info!("  SynapseDB Wire Server listening on {}", bind_addr);
    info!("  - Ingestion: Append-Only WAL + <1ms ACK");
    info!("  - Micro-batching: 8-32 records / 20ms Ring Buffer");
    info!("  - Catalog: Lock-free Dynamic Schema + Synonyms");
    info!("  - Columnar: Contiguous Chunks + Min/Max Zone Maps");
    info!("  - Query Engine: SIMD Vector Scans & Exact Math");
    info!("  - SLM Query Planner: NL to SQL AST Translation");
    info!("=======================================================");

    loop {
        let (socket, remote_addr) = listener.accept().await?;
        let engine_clone = Arc::clone(&engine);

        tokio::spawn(async move {
            if let Err(e) = handle_client(socket, engine_clone).await {
                error!("Client [{}] error: {}", remote_addr, e);
            }
        });
    }
}

async fn handle_client(
    mut socket: TcpStream,
    engine: Arc<DatabaseEngine>,
) -> Result<(), Box<dyn std::error::Error>> {
    let (reader, mut writer) = socket.split();
    let mut buf_reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        line.clear();
        let bytes_read = buf_reader.read_line(&mut line).await?;
        if bytes_read == 0 {
            break; // Connection closed
        }

        let cmd = match ProtocolParser::parse(&line) {
            Ok(c) => c,
            Err(e) => {
                let err_msg = format!("-ERR {}\r\n", e);
                writer.write_all(err_msg.as_bytes()).await?;
                writer.flush().await?;
                continue;
            }
        };

        match cmd {
            Command::Ping => {
                writer.write_all(b"+PONG\r\n").await?;
            }
            Command::Push { table, payload } => {
                match engine.push(&table, &payload) {
                    Ok(row_id) => {
                        // Monotonic RowID returned in < 1ms
                        let resp = format!(":{}\r\n", row_id);
                        writer.write_all(resp.as_bytes()).await?;
                    }
                    Err(e) => {
                        let resp = format!("-ERR {}\r\n", e);
                        writer.write_all(resp.as_bytes()).await?;
                    }
                }
            }
            Command::Query { query } => {
                match engine.query(&query) {
                    Ok(res) => {
                        let json_str = serde_json::to_string_pretty(&res)?;
                        let resp = format!("${}\r\n{}\r\n", json_str.len(), json_str);
                        writer.write_all(resp.as_bytes()).await?;
                    }
                    Err(e) => {
                        let resp = format!("-ERR {}\r\n", e);
                        writer.write_all(resp.as_bytes()).await?;
                    }
                }
            }
            Command::Schema { table } => {
                let s = engine.schema(table.as_deref());
                let json_str = serde_json::to_string_pretty(&s)?;
                let resp = format!("${}\r\n{}\r\n", json_str.len(), json_str);
                writer.write_all(resp.as_bytes()).await?;
            }
            Command::Info => {
                let info = serde_json::json!({
                    "engine": "SynapseDB",
                    "version": "0.1.0",
                    "wal": "Append-Only (CRC32, fsync)",
                    "catalog": "Dynamic Schema Evolution & Synonym Resolution",
                    "storage": "Columnar Arrow-like Chunks with Zone Maps",
                    "query": "Deterministic AST Engine + SLM NL Planner",
                });
                let json_str = serde_json::to_string_pretty(&info)?;
                let resp = format!("${}\r\n{}\r\n", json_str.len(), json_str);
                writer.write_all(resp.as_bytes()).await?;
            }
            Command::Flush => {
                match engine.flush_all() {
                    Ok(()) => {
                        writer.write_all(b"+OK\r\n").await?;
                    }
                    Err(e) => {
                        let resp = format!("-ERR {}\r\n", e);
                        writer.write_all(resp.as_bytes()).await?;
                    }
                }
            }
        }
        writer.flush().await?;
    }

    Ok(())
}
