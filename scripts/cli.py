import socket
import json
import sys

def read_resp(sock):
    """Read a RESP formatted message from socket."""
    line = b""
    while not line.endswith(b"\r\n"):
        chunk = sock.recv(1)
        if not chunk:
            raise ConnectionResetError("Connection closed by server")
        line += chunk
    
    prefix = chr(line[0])
    content = line[1:-2].decode('utf-8', errors='replace')
    
    if prefix == '+':
        return ("STRING", content)
    elif prefix == '-':
        return ("ERROR", content)
    elif prefix == ':':
        return ("INTEGER", int(content))
    elif prefix == '$':
        length = int(content)
        if length == -1:
            return ("NULL", None)
        body = b""
        while len(body) < length:
            chunk = sock.recv(min(length - len(body), 4096))
            if not chunk:
                break
            body += chunk
        sock.recv(2) # trailing \r\n
        return ("JSON", body.decode('utf-8', errors='replace'))
    else:
        return ("RAW", line.decode('utf-8', errors='replace'))

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def print_result(res_type, content):
    if res_type == "STRING":
        print(f"[OK] {content}")
    elif res_type == "INTEGER":
        print(f"[OK] RowID: {content} (durable WAL append committed)")
    elif res_type == "ERROR":
        print(f"[ERROR] {content}")
    elif res_type == "JSON":
        try:
            parsed = json.loads(content)
            # Format nicely
            if "status" in parsed and parsed["status"] == "success":
                rows = parsed.get("rows", [])
                cols = parsed.get("columns", [])
                stats = parsed.get("stats", {})
                print(f"--- Query Result ({parsed.get('row_count', 0)} rows, {stats.get('execution_time_us', 0)} µs) ---")
                if rows:
                    # Print formatted table
                    widths = {c: max(len(c), max(len(str(r.get(c, ""))) for r in rows)) for c in cols}
                    header_line = " | ".join(c.ljust(widths[c]) for c in cols)
                    sep_line = "-+-".join("-" * widths[c] for c in cols)
                    print(header_line)
                    print(sep_line)
                    for r in rows:
                        print(" | ".join(str(r.get(c, "")).ljust(widths[c]) for c in cols))
                else:
                    print("No rows returned.")
            elif "columns" in parsed and "table" in parsed:
                # Schema result
                print(f"--- Schema: {parsed['table']} (Total Rows: {parsed.get('row_count', 0)}) ---")
                for col in parsed.get("columns", []):
                    print(f"  - {col['name']} ({col['type']})")
            else:
                print(json.dumps(parsed, indent=2))
        except Exception:
            print(content)
    else:
        print(content)

def main():
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
    
    print(f"Connecting to SynapseDB at {host}:{port}...")
    try:
        sock = socket.create_connection((host, port), timeout=5.0)
    except Exception as e:
        print(f"Could not connect to {host}:{port}: {e}")
        print("Make sure SynapseDB server is running (e.g. .\\target\\release\\synapsedb.exe)")
        sys.exit(1)
        
    print("Connected to SynapseDB Wire Server!")
    print("Commands:")
    print("  PUSH <table> <raw_json_or_log>   (e.g. PUSH rides {\"fare\": 45.5, \"driver\": \"Alice\"})")
    print("  QUERY <sql_or_nl>                (e.g. QUERY SELECT SUM(amount) FROM rides WHERE amount > 30)")
    print("                                   (e.g. QUERY Total rides spent where amount > 30)")
    print("  SCHEMA <table>                   (e.g. SCHEMA rides)")
    print("  FLUSH                            (Force drain in-memory buffers)")
    print("  INFO / PING")
    print("  exit or quit to exit\n")

    while True:
        try:
            cmd = input("synapsedb> ").strip()
            if not cmd:
                continue
            if cmd.lower() in ("exit", "quit"):
                break
            
            # Send command terminated with CRLF
            sock.sendall(f"{cmd}\r\n".encode('utf-8'))
            t, content = read_resp(sock)
            print_result(t, content)
            print()
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break
        except Exception as e:
            print(f"Communication error: {e}")
            break
            
    sock.close()

if __name__ == "__main__":
    main()
