import socket
import json
import time
import statistics
import sys

def read_resp(sock):
    line = b""
    while not line.endswith(b"\r\n"):
        chunk = sock.recv(1)
        if not chunk:
            raise ConnectionResetError("Socket closed prematurely")
        line += chunk
    
    prefix = chr(line[0])
    content = line[1:-2].decode('utf-8')
    
    if prefix == '+':
        return ("SIMPLE_STRING", content)
    elif prefix == '-':
        return ("ERROR", content)
    elif prefix == ':':
        return ("INTEGER", int(content))
    elif prefix == '$':
        length = int(content)
        if length == -1:
            return ("BULK_STRING", None)
        body = b""
        while len(body) < length:
            chunk = sock.recv(min(length - len(body), 4096))
            if not chunk:
                break
            body += chunk
        crlf = sock.recv(2)
        return ("BULK_STRING", body.decode('utf-8'))
    else:
        return ("UNKNOWN", line.decode('utf-8'))

def benchmark(host="127.0.0.1", port=8765, num_records=2000):
    print("=" * 60)
    print("        SYNAPSEDB PERFORMANCE & LATENCY BENCHMARK        ")
    print("=" * 60)
    
    s = socket.create_connection((host, port), timeout=10.0)
    
    # 1. Benchmark Ingestion (WAL append + immediate durability ACK)
    print(f"\n[1] Ingesting {num_records} records with synchronous WAL commit...")
    latencies_ms = []
    
    start_total = time.perf_counter()
    for i in range(num_records):
        fare = 10.0 + (i % 100) * 1.5
        payload = f'{{"fare": {fare}, "user_id": {1000 + i % 50}, "driver": "driver_{i % 20}"}}'
        cmd = f"PUSH benchmark {payload}\r\n".encode('utf-8')
        
        t0 = time.perf_counter()
        s.sendall(cmd)
        t, val = read_resp(s)
        t1 = time.perf_counter()
        
        if t != "INTEGER":
            print(f"Error at record {i}: {val}")
            break
            
        latencies_ms.append((t1 - t0) * 1000.0)
        
    total_time = time.perf_counter() - start_total
    
    throughput = num_records / total_time
    avg_lat = statistics.mean(latencies_ms)
    median_lat = statistics.median(latencies_ms)
    p95_lat = sorted(latencies_ms)[int(0.95 * len(latencies_ms))]
    p99_lat = sorted(latencies_ms)[int(0.99 * len(latencies_ms))]
    min_lat = min(latencies_ms)
    max_lat = max(latencies_ms)
    
    print(f"  Total Ingestion Time : {total_time:.3f} s")
    print(f"  Ingest Throughput    : {throughput:.1f} writes/sec")
    print(f"  Latency (Avg)        : {avg_lat:.3f} ms")
    print(f"  Latency (Median/p50) : {median_lat:.3f} ms")
    print(f"  Latency (p95)        : {p95_lat:.3f} ms")
    print(f"  Latency (p99)        : {p99_lat:.3f} ms")
    print(f"  Latency (Min / Max)  : {min_lat:.3f} ms / {max_lat:.3f} ms")
    
    # Flush micro-batches into columnar chunks
    print("\n[2] Flushing micro-batching buffer into columnar storage...")
    t0 = time.perf_counter()
    s.sendall(b"FLUSH\r\n")
    read_resp(s)
    print(f"  Flush completed in {(time.perf_counter() - t0)*1000.0:.2f} ms")
    
    # 2. Benchmark Columnar SQL Aggregations
    print("\n[3] Benchmarking Columnar SQL Aggregations (Exact IEEE Math)...")
    query_cmd = "QUERY SELECT COUNT(*), SUM(amount), AVG(amount), MIN(amount), MAX(amount) FROM benchmark\r\n".encode('utf-8')
    
    query_times = []
    res_val = None
    for _ in range(50):
        t0 = time.perf_counter()
        s.sendall(query_cmd)
        t, val = read_resp(s)
        query_times.append((time.perf_counter() - t0) * 1000.0)
        res_val = val
        
    avg_query_time = statistics.mean(query_times)
    median_query_time = statistics.median(query_times)
    min_query_time = min(query_times)
    
    print(f"  Query Result         : {res_val.strip()}")
    print(f"  Aggregate Latency    : Min={min_query_time:.3f} ms, Median={median_query_time:.3f} ms, Avg={avg_query_time:.3f} ms")
    
    # 3. Benchmark Filtered Query with Zone Map Pruning
    print("\n[4] Benchmarking Predicate Filter with Min/Max Zone Map Pruning...")
    filter_cmd = "QUERY SELECT COUNT(*), SUM(amount) FROM benchmark WHERE amount > 140\r\n".encode('utf-8')
    
    filter_times = []
    res_filtered = None
    for _ in range(50):
        t0 = time.perf_counter()
        s.sendall(filter_cmd)
        t, val = read_resp(s)
        filter_times.append((time.perf_counter() - t0) * 1000.0)
        res_filtered = val
        
    print(f"  Filtered Result      : {res_filtered.strip()}")
    print(f"  Filtered Latency     : Min={min(filter_times):.3f} ms, Median={statistics.median(filter_times):.3f} ms")
    
    # 4. SLM Natural Language Query
    print("\n[5] Benchmarking SLM Natural Language Query Compilation & Execution...")
    nl_cmd = "QUERY Total benchmark spent where amount > 140\r\n".encode('utf-8')
    t0 = time.perf_counter()
    s.sendall(nl_cmd)
    t, val = read_resp(s)
    nl_latency = (time.perf_counter() - t0) * 1000.0
    print(f"  NL Query Result      : {val.strip()}")
    print(f"  NL Compilation + Exec: {nl_latency:.3f} ms")
    
    s.close()
    print("\n" + "=" * 60)
    print("BENCHMARK COMPLETED SUCCESSFULLY")
    print("=" * 60)

if __name__ == "__main__":
    benchmark()
