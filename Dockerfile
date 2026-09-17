# -------------------------------------------------------------
# Stage 1: Build binary with Rust compiler
# -------------------------------------------------------------
FROM rust:1.80-bullseye AS builder

WORKDIR /usr/src/synapsedb

# Copy Cargo configuration and source crates
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates

# Build high-performance release binary
RUN cargo build --release --bin synapsedb

# -------------------------------------------------------------
# Stage 2: Ultra-lightweight Debian runtime image
# -------------------------------------------------------------
FROM debian:bullseye-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libgcc-s1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binary from builder
COPY --from=builder /usr/src/synapsedb/target/release/synapsedb /usr/local/bin/synapsedb

# Environment configuration
ENV SYNAPSE_ADDR="0.0.0.0:8765"
ENV SYNAPSE_DATA_DIR="/data"
ENV RUST_LOG="info"

# Data persistence for WAL and columnar segment files
VOLUME ["/data"]

# Expose TCP wire protocol port
EXPOSE 8765

# Start database engine
ENTRYPOINT ["/usr/local/bin/synapsedb"]
