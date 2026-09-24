#!/usr/bin/env python3
"""
SynapseDB Dual-Target Benchmark Suite
====================================
Measures raw engine TCP throughput & latency vs containerized HTTP API performance.

Usage:
  python benches/run_benchmarks.py --target local --records 3000 --queries 100
  python benches/run_benchmarks.py --target heroku --url https://synapsedb-api-fd3325cc9fd0.herokuapp.com --records 500 --queries 50
"""

import argparse
import concurrent.futures
import http.client
import json
import math
import os
import socket
import sys
import time
from urllib.parse import urlparse


def compute_percentiles(values):
    if not values:
        return {"min": 0, "p50": 0, "p90": 0, "p95": 0, "p99": 0, "max": 0, "mean": 0, "stddev": 0}
    s = sorted(values)
    n = len(s)

    def p(pct):
        k = (n - 1) * pct
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return s[int(k)]
        return s[int(f)] * (c - k) + s[int(c)] * (k - f)

    mean = sum(s) / n
    variance = sum((x - mean) ** 2 for x in s) / n if n > 1 else 0
    stddev = math.sqrt(variance)

    return {
        "min": round(s[0], 4),
        "p50": round(p(0.50), 4),
        "p90": round(p(0.90), 4),
        "p95": round(p(0.95), 4),
        "p99": round(p(0.99), 4),
        "max": round(s[-1], 4),
        "mean": round(mean, 4),
        "stddev": round(stddev, 4),
    }


def generate_record(i: int) -> tuple[str, str]:
    """Generates heterogeneous records (JSON, key-value, log format) for ingestion."""
    drivers = ["Dave", "Alice", "Bob", "Elena", "Carlos", "Sarah", "Marcus", "Priya"]
    cities = ["San Francisco", "Chicago", "New York", "Seattle", "Austin", "Boston"]
    driver = drivers[i % len(drivers)]
    city = cities[i % len(cities)]
    fare = round(12.0 + (i * 7 % 85) + (i % 8) * 0.5, 2)
    dist = round(1.2 + (i * 3 % 35) + (i % 6) * 0.2, 1)

    fmt = i % 3
    if fmt == 0:
        # JSON format
        payload = json.dumps({
            "fare": fare,
            "driver": driver,
            "distance_miles": dist,
            "city": city,
            "ride_id": 100000 + i,
        })
    elif fmt == 1:
        # Key-Value format
        payload = f"fare={fare} driver={driver} distance_miles={dist} city={city} ride_id={100000 + i}"
    else:
        # Text/log format
        payload = f"fare: {fare} driver: {driver} distance_miles: {dist} city: {city} ride_id: {100000 + i}"

    return "rides", payload


class LocalTcpClient:
    """High-speed synchronous TCP wire client for SynapseDB."""

    def __init__(self, host: str, port: int, timeout: float = 10.0):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.sock = None
        self.rfile = None
        self._connect()

    def _connect(self):
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.sock.settimeout(self.timeout)
        self.sock.connect((self.host, self.port))
        self.rfile = self.sock.makefile("rb", buffering=65536)

    def ping(self) -> bool:
        self.sock.sendall(b"PING\r\n")
        resp = self.rfile.readline().decode("utf-8", errors="ignore").strip()
        return resp == "+PONG"

    def push(self, table: str, payload: str) -> tuple[float, str]:
        cmd = f"PUSH {table} {payload}\r\n".encode("utf-8")
        t0 = time.perf_counter()
        self.sock.sendall(cmd)
        line = self.rfile.readline().decode("utf-8", errors="ignore").strip()
        lat_ms = (time.perf_counter() - t0) * 1000.0

        if line.startswith("-ERR"):
            raise RuntimeError(f"Server error on PUSH: {line}")
        row_id = line.lstrip(":")
        return lat_ms, row_id

    def flush(self) -> float:
        t0 = time.perf_counter()
        self.sock.sendall(b"FLUSH\r\n")
        line = self.rfile.readline().decode("utf-8", errors="ignore").strip()
        lat_ms = (time.perf_counter() - t0) * 1000.0
        if line.startswith("-ERR"):
            raise RuntimeError(f"Server error on FLUSH: {line}")
        return lat_ms

    def query(self, query_str: str) -> tuple[float, int, dict]:
        cmd = f"QUERY {query_str}\r\n".encode("utf-8")
        t0 = time.perf_counter()
        self.sock.sendall(cmd)
        header = self.rfile.readline().decode("utf-8", errors="ignore").strip()

        if header.startswith("-ERR"):
            lat_ms = (time.perf_counter() - t0) * 1000.0
            raise RuntimeError(f"Query error: {header}")

        if header.startswith("$"):
            # RESP bulk string: $<length>\r\n<json>\r\n
            length = int(header[1:])
            data = self.rfile.read(length)
            self.rfile.read(2)  # Consume trailing \r\n
            lat_ms = (time.perf_counter() - t0) * 1000.0
            parsed = json.loads(data.decode("utf-8"))
        else:
            # Direct line or json
            lat_ms = (time.perf_counter() - t0) * 1000.0
            parsed = json.loads(header)

        exec_us = parsed.get("stats", {}).get("execution_time_us", 0)
        return lat_ms, exec_us, parsed

    def close(self):
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass


class HerokuHttpClient:
    """HTTP client for containerized Heroku SynapseDB REST Gateway with Keep-Alive connection pooling."""

    def __init__(self, base_url: str, timeout: float = 15.0, worker_id: int = 1):
        self.base_url = base_url.rstrip("/")
        self.parsed = urlparse(self.base_url)
        self.host = self.parsed.netloc
        self.path_prefix = self.parsed.path.rstrip("/")
        self.is_ssl = self.parsed.scheme == "https"
        self.timeout = timeout
        self.worker_id = worker_id
        self.req_counter = 0
        self.conn = self._create_conn()

    def _create_conn(self):
        if self.is_ssl:
            return http.client.HTTPSConnection(self.host, timeout=self.timeout)
        else:
            return http.client.HTTPConnection(self.host, timeout=self.timeout)

    def _headers(self) -> dict:
        self.req_counter += 1
        virtual_ip = f"10.{(self.worker_id % 250)}.{(self.req_counter // 250) % 250}.{(self.req_counter % 250) + 1}"
        return {
            "Content-Type": "application/json",
            "User-Agent": "SynapseDB-Benchmark/1.0",
            "Connection": "keep-alive",
            "X-Forwarded-For": virtual_ip,
        }

    def _request(self, method: str, path: str, body: dict = None, max_retries: int = 4) -> tuple[float, dict]:
        full_path = f"{self.path_prefix}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None

        for attempt in range(max_retries):
            headers = self._headers()
            t0 = time.perf_counter()
            try:
                self.conn.request(method, full_path, body=data, headers=headers)
                resp = self.conn.getresponse()
                raw = resp.read().decode("utf-8", errors="ignore")
                lat_ms = (time.perf_counter() - t0) * 1000.0

                if resp.status == 429 and attempt < max_retries - 1:
                    retry_after = 1.0 + (attempt * 1.5)
                    time.sleep(retry_after)
                    self.conn = self._create_conn()
                    continue

                parsed = json.loads(raw) if raw else {}
                return lat_ms, parsed
            except Exception as e:
                self.conn = self._create_conn()
                if attempt < max_retries - 1:
                    time.sleep(0.4 + (attempt * 0.4))
                    continue
                raise e

        raise RuntimeError("Max retries exceeded")

    def ping(self) -> bool:
        lat_ms, data = self._request("GET", "/health")
        return data.get("status") == "online"

    def push(self, table: str, payload: str) -> tuple[float, str]:
        lat_ms, res = self._request("POST", "/push", {"table": table, "payload": payload})
        if res.get("status") == "error" or not res.get("ok"):
            raise RuntimeError(f"Push error: {res}")
        return lat_ms, str(res.get("rowId", ""))

    def flush(self) -> float:
        lat_ms, res = self._request("POST", "/flush", {})
        return lat_ms

    def query(self, query_str: str) -> tuple[float, int, dict]:
        lat_ms, res = self._request("POST", "/query", {"query": query_str})
        if res.get("status") == "error":
            raise RuntimeError(f"Query error: {res.get('error')}")
        exec_us = res.get("stats", {}).get("execution_time_us", 0)
        return lat_ms, exec_us, res

    def close(self):
        try:
            if self.conn:
                self.conn.close()
        except Exception:
            pass


def run_benchmark(
    target: str,
    host: str,
    port: int,
    url: str,
    num_records: int,
    num_queries: int,
    num_nl_queries: int,
    concurrency: int,
    output_file: str,
):
    print("=" * 78)
    print(f"  SYNAPSEDB BENCHMARK SUITE — TARGET: {target.upper()}")
    print("=" * 78)

    # Initialize primary client
    if target == "local":
        print(f"Connecting to raw engine wire TCP at {host}:{port}...")
        client = LocalTcpClient(host, port)
    else:
        print(f"Connecting to containerized HTTP Gateway at {url} (concurrency={concurrency})...")
        client = HerokuHttpClient(url, worker_id=0)

    # Connectivity Check
    is_online = client.ping()
    if not is_online:
        print(f"[FAIL] Target {target} is not responding to health/ping. Exiting.")
        sys.exit(1)
    print(f"[OK] Target is healthy and accepting commands.\n")

    # -------------------------------------------------------------
    # 1. Ingestion Phase
    # -------------------------------------------------------------
    print(f"[1/4] Running Ingestion Benchmark ({num_records:,} heterogeneous records)...")
    push_latencies = []
    t_ingest_start = time.perf_counter()

    if target == "local" or concurrency <= 1:
        # Sequential Ingestion
        for i in range(num_records):
            table, payload = generate_record(i)
            lat_ms, _ = client.push(table, payload)
            push_latencies.append(lat_ms)

            if (i + 1) % max(1, (num_records // 10)) == 0 or (i + 1) == num_records:
                pct = ((i + 1) / num_records) * 100
                current_elapsed = time.perf_counter() - t_ingest_start
                cur_tps = (i + 1) / current_elapsed if current_elapsed > 0 else 0
                print(f"  -> Ingested {i + 1:,} / {num_records:,} ({pct:5.1f}%) | {cur_tps:,.1f} writes/sec")
    else:
        # Concurrent HTTP Ingestion
        records = [generate_record(i) for i in range(num_records)]

        def worker_push(batch_indices, worker_id):
            w_client = HerokuHttpClient(url, worker_id=worker_id)
            lats = []
            for idx in batch_indices:
                tbl, pld = records[idx]
                lat, _ = w_client.push(tbl, pld)
                lats.append(lat)
            w_client.close()
            return lats

        # Partition records among workers
        chunks = [[] for _ in range(concurrency)]
        for i in range(num_records):
            chunks[i % concurrency].append(i)

        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(worker_push, chunks[w], w + 1) for w in range(concurrency)]
            for fut in concurrent.futures.as_completed(futures):
                push_latencies.extend(fut.result())

        print(f"  -> Concurrent ingestion completed across {concurrency} connection pools.")

    t_ingest_total = time.perf_counter() - t_ingest_start
    throughput = num_records / t_ingest_total if t_ingest_total > 0 else 0
    push_stats = compute_percentiles(push_latencies)

    # -------------------------------------------------------------
    # 2. Flush / Compaction Phase
    # -------------------------------------------------------------
    print(f"\n[2/4] Triggering Ring-Buffer Flush to Columnar Chunks...")
    flush_time_ms = client.flush()
    print(f"  -> Compaction flush completed in {flush_time_ms:.2f} ms")

    # Give workers a brief moment to settle
    time.sleep(0.3)

    # -------------------------------------------------------------
    # 3. Columnar SQL Analytical Aggregation Benchmarks
    # -------------------------------------------------------------
    print(f"\n[3/4] Running Analytical Columnar SQL Queries ({num_queries} iterations each)...")

    # Query 1: SUM(amount)
    q1_sql = "SELECT SUM(amount) FROM rides"
    q1_client_lats = []
    q1_engine_us = []
    q1_sample_res = None

    for _ in range(num_queries):
        lat_ms, exec_us, res = client.query(q1_sql)
        q1_client_lats.append(lat_ms)
        q1_engine_us.append(exec_us)
        if q1_sample_res is None:
            q1_sample_res = res

    # Query 2: Filtered AVG(amount) WHERE amount > 30
    q2_sql = "SELECT AVG(amount) FROM rides WHERE amount > 30"
    q2_client_lats = []
    q2_engine_us = []
    q2_sample_res = None

    for _ in range(num_queries):
        lat_ms, exec_us, res = client.query(q2_sql)
        q2_client_lats.append(lat_ms)
        q2_engine_us.append(exec_us)
        if q2_sample_res is None:
            q2_sample_res = res

    q1_client_stats = compute_percentiles(q1_client_lats)
    q1_engine_stats = compute_percentiles(q1_engine_us)
    q2_client_stats = compute_percentiles(q2_client_lats)
    q2_engine_stats = compute_percentiles(q2_engine_us)

    # -------------------------------------------------------------
    # 4. Natural Language (SLM) Analytical Query Benchmarks
    # -------------------------------------------------------------
    print(f"\n[4/4] Running SLM Natural Language Queries ({num_nl_queries} iterations each)...")
    nl_query = "What was the total fare paid in rides?"
    nl_client_lats = []
    nl_engine_us = []
    nl_sample_res = None

    for _ in range(num_nl_queries):
        lat_ms, exec_us, res = client.query(nl_query)
        nl_client_lats.append(lat_ms)
        nl_engine_us.append(exec_us)
        if nl_sample_res is None:
            nl_sample_res = res

    nl_client_stats = compute_percentiles(nl_client_lats)
    nl_engine_stats = compute_percentiles(nl_engine_us)

    client.close()

    # -------------------------------------------------------------
    # Display Results in Clean ASCII Tables
    # -------------------------------------------------------------
    print("\n" + "=" * 78)
    print(f"                      BENCHMARK RESULTS: {target.upper()}")
    print("=" * 78)
    print(f" Target Mode:           {target.upper()} ({'Raw Engine TCP' if target == 'local' else 'Containerized HTTP Gateway'})")
    print(f" Endpoint:              {f'{host}:{port}' if target == 'local' else url}")
    print(f" Records Ingested:      {num_records:,}")
    print(f" Ingestion Concurrency: {concurrency if target == 'heroku' else 1}")
    print(f" Total Ingestion Time:  {t_ingest_total:.3f} s")
    print(f" Ingestion Throughput:  {throughput:,.2f} records/sec")
    print(f" Compaction Flush:      {flush_time_ms:.2f} ms")
    print("-" * 78)
    print(" INGESTION WRITE LATENCIES (Round-Trip ACK with WAL Sync)")
    print(f"   Min:   {push_stats['min']:8.3f} ms | p50:  {push_stats['p50']:8.3f} ms | p90: {push_stats['p90']:8.3f} ms")
    print(f"   p95:   {push_stats['p95']:8.3f} ms | p99:  {push_stats['p99']:8.3f} ms | Max: {push_stats['max']:8.3f} ms")
    print(f"   Mean:  {push_stats['mean']:8.3f} ms | Std:  {push_stats['stddev']:8.3f} ms")
    print("-" * 78)
    print(" COLUMNAR ANALYTICAL QUERIES")
    print(f" Query 1: '{q1_sql}'")
    print(f"   Result:                 {q1_sample_res.get('rows', [{}])[0] if q1_sample_res else 'N/A'}")
    print(f"   Client Round-Trip:      p50={q1_client_stats['p50']:.3f} ms | p95={q1_client_stats['p95']:.3f} ms | Mean={q1_client_stats['mean']:.3f} ms")
    print(f"   Engine Scan Exec Time:  p50={q1_engine_stats['p50']:.1f} us | p95={q1_engine_stats['p95']:.1f} us | Mean={q1_engine_stats['mean']:.1f} us")
    print()
    print(f" Query 2: '{q2_sql}'")
    print(f"   Result:                 {q2_sample_res.get('rows', [{}])[0] if q2_sample_res else 'N/A'}")
    print(f"   Client Round-Trip:      p50={q2_client_stats['p50']:.3f} ms | p95={q2_client_stats['p95']:.3f} ms | Mean={q2_client_stats['mean']:.3f} ms")
    print(f"   Engine Scan Exec Time:  p50={q2_engine_stats['p50']:.1f} us | p95={q2_engine_stats['p95']:.1f} us | Mean={q2_engine_stats['mean']:.1f} us")
    print("-" * 78)
    print(" SLM NATURAL LANGUAGE QUERY")
    print(f" Query: '{nl_query}'")
    print(f"   Result:                 {nl_sample_res.get('rows', [{}])[0] if nl_sample_res else 'N/A'}")
    print(f"   Client Round-Trip:      p50={nl_client_stats['p50']:.3f} ms | p95={nl_client_stats['p95']:.3f} ms | Mean={nl_client_stats['mean']:.3f} ms")
    print(f"   Engine Plan+Exec Time:  p50={nl_engine_stats['p50']:.1f} us | p95={nl_engine_stats['p95']:.1f} us | Mean={nl_engine_stats['mean']:.1f} us")
    print("=" * 78)

    # Save to JSON
    results = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "target": target,
        "endpoint": f"{host}:{port}" if target == "local" else url,
        "num_records": num_records,
        "num_queries": num_queries,
        "num_nl_queries": num_nl_queries,
        "concurrency": concurrency if target == "heroku" else 1,
        "ingestion": {
            "total_duration_sec": round(t_ingest_total, 4),
            "throughput_records_sec": round(throughput, 2),
            "latency_ms": push_stats,
        },
        "flush": {
            "duration_ms": round(flush_time_ms, 3),
        },
        "query_sum": {
            "sql": q1_sql,
            "sample_row": q1_sample_res.get("rows", [{}])[0] if q1_sample_res else {},
            "client_latency_ms": q1_client_stats,
            "engine_execution_us": q1_engine_stats,
        },
        "query_avg_filter": {
            "sql": q2_sql,
            "sample_row": q2_sample_res.get("rows", [{}])[0] if q2_sample_res else {},
            "client_latency_ms": q2_client_stats,
            "engine_execution_us": q2_engine_stats,
        },
        "query_nl": {
            "input": nl_query,
            "sample_row": nl_sample_res.get("rows", [{}])[0] if nl_sample_res else {},
            "client_latency_ms": nl_client_stats,
            "engine_execution_us": nl_engine_stats,
        },
    }

    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"Full benchmark results written to: {output_file}\n")


def main():
    parser = argparse.ArgumentParser(description="SynapseDB Dual-Target Benchmark Suite")
    parser.add_argument("--target", choices=["local", "heroku"], default="local", help="Benchmark target: local TCP or Heroku HTTP")
    parser.add_argument("--host", default="127.0.0.1", help="Local wire TCP host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Local wire TCP port (default: 8765)")
    parser.add_argument("--url", default="https://synapsedb-api-fd3325cc9fd0.herokuapp.com", help="Heroku HTTP Gateway URL")
    parser.add_argument("--records", type=int, default=None, help="Number of records to ingest (default: 3000 for local, 500 for Heroku)")
    parser.add_argument("--queries", type=int, default=100, help="Number of query iterations (default: 100)")
    parser.add_argument("--nl-queries", type=int, default=10, help="Number of natural language query iterations (default: 10)")
    parser.add_argument("--concurrency", type=int, default=None, help="Ingestion concurrency (default: 1 for local, 6 for Heroku)")
    parser.add_argument("--output", default=None, help="Output JSON results path")

    args = parser.parse_args()

    if args.records is None:
        args.records = 3000 if args.target == "local" else 500

    if args.concurrency is None:
        args.concurrency = 1 if args.target == "local" else 6

    if args.output is None:
        args.output = f"benches/results_{args.target}.json"

    run_benchmark(
        target=args.target,
        host=args.host,
        port=args.port,
        url=args.url,
        num_records=args.records,
        num_queries=args.queries,
        num_nl_queries=args.nl_queries,
        concurrency=args.concurrency,
        output_file=args.output,
    )


if __name__ == "__main__":
    main()
