# -------------------------------------------------------------
# Stage 1: Build Rust binary
# -------------------------------------------------------------
FROM rust:1.80-bullseye AS builder

WORKDIR /usr/src/synapsedb
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates

RUN cargo build --release --bin synapsedb

# -------------------------------------------------------------
# Stage 2: Runtime image with Python REST Gateway
# -------------------------------------------------------------
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libgcc-s1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binary from builder
COPY --from=builder /usr/src/synapsedb/target/release/synapsedb /usr/local/bin/synapsedb

# Copy gateway and entrypoint
COPY gateway.py entrypoint.sh ./
RUN chmod +x /usr/local/bin/synapsedb /app/entrypoint.sh

# Port configuration (defaults to 7860, respects $PORT from cloud providers like Render)
ENV PORT=7860
ENV SYNAPSE_ADDR="127.0.0.1:8765"
ENV SYNAPSE_DATA_DIR="/data"

EXPOSE 7860
EXPOSE 8765

CMD ["/app/entrypoint.sh"]
