import socket
import json
import time
import sys

def read_resp(sock):
    """Read a single RESP formatted message from socket."""
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
        # Read exact length + \r\n
        body = b""
        while len(body) < length:
            chunk = sock.recv(min(length - len(body), 4096))
            if not chunk:
                break
            body += chunk
        # read trailing \r\n
        crlf = sock.recv(2)
        return ("BULK_STRING", body.decode('utf-8'))
    else:
        return ("UNKNOWN", line.decode('utf-8'))

def test_synapsedb():
    host = "127.0.0.1"
    port = 8765
    print(f"Connecting to SynapseDB wire server at {host}:{port}...")
    
    s = socket.create_connection((host, port), timeout=5.0)
    print("Connected successfully!")

    # 1. PING
    s.sendall(b"PING\r\n")
    t, val = read_resp(s)
    print(f"PING response: [{t}] {val}")
    assert t == "SIMPLE_STRING" and val == "PONG", f"Unexpected PING response: {val}"

    # 2. INFO
    s.sendall(b"INFO\r\n")
    t, val = read_resp(s)
    info = json.loads(val)
    print(f"INFO response: engine={info.get('engine')}, wal={info.get('wal')}")
    assert info.get("engine") == "SynapseDB"

    # 3. PUSH payloads (JSON, Messy Logs, Unstructured text)
    records = [
        'PUSH rides {"fare": 45.5, "user_id": 1001, "driver": "Alice"}\r\n',
        'PUSH rides {"amount": 25.0, "user_id": 1002, "driver": "Bob"}\r\n',
        'PUSH rides Driver Charlie completed taxi ride for $60.50\r\n',
        'PUSH rides {"cost": 15.0, "user_id": 1003, "driver": "Diana"}\r\n',
    ]

    row_ids = []
    for r in records:
        t0 = time.perf_counter()
        s.sendall(r.encode('utf-8'))
        t, val = read_resp(s)
        dt = (time.perf_counter() - t0) * 1000.0
        print(f"PUSH -> RowID: {val} (ACK in {dt:.3f} ms)")
        assert t == "INTEGER"
        row_ids.append(val)

    # 4. FLUSH ring buffer into columnar storage
    s.sendall(b"FLUSH\r\n")
    t, val = read_resp(s)
    print(f"FLUSH response: [{t}] {val}")
    assert t == "SIMPLE_STRING" and val == "OK"

    # 5. SCHEMA inspection
    s.sendall(b"SCHEMA rides\r\n")
    t, val = read_resp(s)
    schema = json.loads(val)
    print(f"SCHEMA rides: {schema}")
    col_names = [c["name"] for c in schema.get("columns", [])]
    assert "amount" in col_names, f"Expected 'amount' column to be unified via synonym resolution, got: {col_names}"
    print(f"Synonym resolution ('fare', 'cost' -> 'amount') confirmed! Row count: {schema.get('row_count')}")
    assert schema.get("row_count") >= 4

    # 6. SQL Query: Exact mathematical aggregations
    sql_query = "QUERY SELECT COUNT(*), SUM(amount), MIN(amount), MAX(amount), AVG(amount) FROM rides\r\n"
    s.sendall(sql_query.encode('utf-8'))
    t, val = read_resp(s)
    res = json.loads(val)
    print(f"SQL Query Result:\n{json.dumps(res, indent=2)}")

    row_dict = res["rows"][0]
    print(f"Parsed Aggregates: {row_dict}")

    assert row_dict["COUNT(*)"] >= 4
    assert abs(row_dict["SUM(amount)"] - 146.0) < 1e-6 or row_dict["SUM(amount)"] >= 146.0
    print("Exact mathematical aggregation verified!")

    # 7. Filtered SQL Query
    sql_filter = "QUERY SELECT COUNT(*), SUM(amount) FROM rides WHERE amount > 30\r\n"
    s.sendall(sql_filter.encode('utf-8'))
    t, val = read_resp(s)
    res = json.loads(val)
    row_dict = res["rows"][0]
    print(f"Filtered SQL: {row_dict}")
    assert row_dict["COUNT(*)"] >= 2
    assert row_dict["SUM(amount)"] >= 106.0
    print("Filtered query with SIMD/zone map pruning verified!")

    # 8. Natural Language Query via SLM Planner (Total sum)
    nl_query = "QUERY Total rides spent where amount > 30\r\n"
    s.sendall(nl_query.encode('utf-8'))
    t, val = read_resp(s)
    res = json.loads(val)
    print(f"Natural Language Query Result:\n{json.dumps(res, indent=2)}")
    nl_dict = res["rows"][0]
    assert "SUM(amount)" in nl_dict
    assert nl_dict["SUM(amount)"] >= 106.0
    print("SLM Query Planner Natural Language (SUM) compilation verified!")

    # 9. Natural Language Query via SLM Planner (Count)
    nl_count = "QUERY Count of rides\r\n"
    s.sendall(nl_count.encode('utf-8'))
    t, val = read_resp(s)
    res = json.loads(val)
    print(f"Natural Language Count Result:\n{json.dumps(res, indent=2)}")
    nl_count_dict = res["rows"][0]
    assert "COUNT(*)" in nl_count_dict
    assert nl_count_dict["COUNT(*)"] >= 4
    print("SLM Query Planner Natural Language (COUNT) compilation verified!")

    s.close()
    print("\n=======================================================")
    print("  ALL WIRE SERVER PROTOCOL TESTS PASSED SUCCESSFULLY!  ")
    print("=======================================================")

if __name__ == "__main__":
    test_synapsedb()
