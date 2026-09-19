import os
import json
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler

TCP_HOST = os.environ.get("SYNAPSE_TCP_HOST", "127.0.0.1")
TCP_PORT = int(os.environ.get("SYNAPSE_TCP_PORT", "8765"))

def execute_tcp(cmd: str, timeout: float = 5.0) -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    s.connect((TCP_HOST, TCP_PORT))
    clean_cmd = cmd.replace("\r", " ").replace("\n", " ").strip()
    s.sendall(clean_cmd.encode("utf-8") + b"\r\n")
    
    data = b""
    while True:
        chunk = s.recv(4096)
        if not chunk:
            break
        data += chunk
        if b"\r\n" in data:
            if not data.startswith(b"$") or (data.startswith(b"$") and data.count(b"\r\n") >= 2):
                break
    s.close()
    return data.decode("utf-8", errors="ignore")

class SynapseGatewayHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        
        if path == "" or path == "/health" or path == "/ping":
            try:
                res = execute_tcp("PING")
                self._respond_json(200, {"status": "online", "engine": "SynapseDB", "ping": res.strip()})
            except Exception as e:
                self._respond_json(503, {"status": "error", "error": str(e)})

        elif path == "/info":
            try:
                raw = execute_tcp("INFO")
                idx = raw.find("{")
                data = json.loads(raw[idx:]) if idx != -1 else {"raw": raw.strip()}
                self._respond_json(200, data)
            except Exception as e:
                self._respond_json(500, {"error": str(e)})

        elif path == "/schema":
            query_params = {}
            if "?" in self.path:
                for part in self.path.split("?")[1].split("&"):
                    if "=" in part:
                        k, v = part.split("=", 1)
                        query_params[k] = v
            table = query_params.get("table", "")
            cmd = f"SCHEMA {table}".strip()
            try:
                raw = execute_tcp(cmd)
                idx = raw.find("{")
                data = json.loads(raw[idx:]) if idx != -1 else {"raw": raw.strip()}
                self._respond_json(200, data)
            except Exception as e:
                self._respond_json(500, {"error": str(e)})

        else:
            self._respond_json(404, {"error": "Not Found", "available_endpoints": ["/health", "/info", "/schema", "/query", "/push", "/flush"]})

    def do_POST(self):
        path = self.path.rstrip("/")
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        
        try:
            payload = json.loads(body) if body else {}
        except Exception:
            self._respond_json(400, {"error": "Invalid JSON payload"})
            return

        if path == "/query":
            query_str = payload.get("query", "").strip()
            if not query_str:
                self._respond_json(400, {"error": "Missing 'query' parameter"})
                return
            try:
                raw = execute_tcp(f"QUERY {query_str}", timeout=10.0)
                idx = raw.find("{")
                if idx != -1:
                    data = json.loads(raw[idx:])
                else:
                    data = {"raw": raw.strip()}
                self._respond_json(200, data)
            except Exception as e:
                self._respond_json(500, {"error": str(e)})

        elif path == "/push":
            table = payload.get("table", "rides").strip()
            item = payload.get("payload", "").strip()
            if not item:
                self._respond_json(400, {"error": "Missing 'payload' parameter"})
                return
            try:
                raw = execute_tcp(f"PUSH {table} {item}")
                row_id = raw.strip().lstrip(":")
                self._respond_json(200, {"ok": True, "table": table, "rowId": row_id, "raw": raw.strip()})
            except Exception as e:
                self._respond_json(500, {"error": str(e)})

        elif path == "/flush":
            try:
                raw = execute_tcp("FLUSH")
                self._respond_json(200, {"ok": True, "response": raw.strip()})
            except Exception as e:
                self._respond_json(500, {"error": str(e)})
        else:
            self._respond_json(404, {"error": "Endpoint not found"})

    def _respond_json(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self._send_cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "7860"))
    print(f"SynapseDB REST Gateway listening on http://0.0.0.0:{port}")
    server = HTTPServer(("0.0.0.0", port), SynapseGatewayHandler)
    server.serve_forever()
