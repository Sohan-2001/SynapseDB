import os
import json
import time
import socket
import re
from collections import defaultdict
from threading import Lock
from http.server import HTTPServer, BaseHTTPRequestHandler

# -------------------------------------------------------------
# Configuration (Environment-driven, zero hardcoded secrets)
# -------------------------------------------------------------
TCP_HOST = os.environ.get("SYNAPSE_TCP_HOST", "127.0.0.1")
TCP_PORT = int(os.environ.get("SYNAPSE_TCP_PORT", "8765"))

# Maximum payload size (default 100 KB = 102,400 bytes)
MAX_PAYLOAD_BYTES = int(os.environ.get("MAX_PAYLOAD_BYTES", str(100 * 1024)))

# Rate Limiting: 60 requests per minute per IP by default
RATE_LIMIT_MAX = int(os.environ.get("RATE_LIMIT_MAX", "60"))
RATE_LIMIT_WINDOW = int(os.environ.get("RATE_LIMIT_WINDOW", "60"))

# Allowed CORS Origin (default * for public playground)
CORS_ALLOW_ORIGIN = os.environ.get("CORS_ALLOW_ORIGIN", "*")

# Optional Admin / Write API Key (if set in Heroku config, protects /push and /flush)
SYNAPSE_API_KEY = os.environ.get("SYNAPSE_API_KEY", "")

# -------------------------------------------------------------
# Thread-Safe In-Memory Sliding Window Rate Limiter
# -------------------------------------------------------------
class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)
        self.lock = Lock()
        self.last_cleanup = time.time()

    def is_allowed(self, ip: str) -> tuple[bool, int, int]:
        now = time.time()
        with self.lock:
            # Periodic cleanup of expired IPs (every 5 minutes)
            if now - self.last_cleanup > 300:
                self._cleanup(now)
                self.last_cleanup = now

            window_start = now - self.window_seconds
            timestamps = self.requests[ip]
            
            # Prune timestamps older than window
            self.requests[ip] = [t for t in timestamps if t > window_start]
            current_count = len(self.requests[ip])

            if current_count >= self.max_requests:
                earliest = self.requests[ip][0]
                retry_after = max(1, int(self.window_seconds - (now - earliest)))
                return False, 0, retry_after

            self.requests[ip].append(now)
            remaining = self.max_requests - (current_count + 1)
            return True, remaining, 0

    def _cleanup(self, now: float):
        cutoff = now - self.window_seconds
        dead_ips = [ip for ip, ts in self.requests.items() if not ts or ts[-1] <= cutoff]
        for ip in dead_ips:
            del self.requests[ip]

limiter = SlidingWindowRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW)

# -------------------------------------------------------------
# TCP Wire Protocol Client with Timeout Guards
# -------------------------------------------------------------
TABLE_NAME_REGEX = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")

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

# -------------------------------------------------------------
# HTTP Request Handler with Security Hardening
# -------------------------------------------------------------
class SynapseGatewayHandler(BaseHTTPRequestHandler):
    def get_client_ip(self) -> str:
        # Check X-Forwarded-For if behind Heroku reverse proxy
        forwarded = self.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def _send_security_headers(self, remaining: int = 60, retry_after: int = 0):
        # CORS
        self.send_header("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
        
        # Hardened Security Headers
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-XSS-Protection", "1; mode=block")
        
        # Rate Limit Headers
        self.send_header("X-RateLimit-Limit", str(RATE_LIMIT_MAX))
        self.send_header("X-RateLimit-Remaining", str(max(0, remaining)))
        if retry_after > 0:
            self.send_header("Retry-After", str(retry_after))

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_security_headers()
        self.end_headers()

    def check_rate_limit(self) -> bool:
        ip = self.get_client_ip()
        allowed, remaining, retry_after = limiter.is_allowed(ip)
        if not allowed:
            self._respond_json(
                429,
                {
                    "status": "error",
                    "code": 429,
                    "error": "Too Many Requests",
                    "message": f"Rate limit exceeded ({RATE_LIMIT_MAX} requests/minute). Please wait {retry_after} seconds.",
                    "retry_after": retry_after,
                },
                remaining=0,
                retry_after=retry_after,
            )
            return False
        self._current_remaining = remaining
        return True

    def check_auth(self) -> bool:
        if not SYNAPSE_API_KEY:
            return True  # Open demo mode
        auth_header = self.headers.get("Authorization", "")
        api_key_header = self.headers.get("X-API-Key", "")
        token = ""
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        elif api_key_header:
            token = api_key_header.strip()
        return token == SYNAPSE_API_KEY

    def do_GET(self):
        if not self.check_rate_limit():
            return

        path = self.path.split("?")[0].rstrip("/")
        
        if path == "" or path == "/health" or path == "/ping":
            try:
                res = execute_tcp("PING", timeout=3.0)
                self._respond_json(200, {
                    "status": "online",
                    "engine": "SynapseDB",
                    "ping": res.strip(),
                    "rate_limit_limit": RATE_LIMIT_MAX,
                    "max_payload_bytes": MAX_PAYLOAD_BYTES
                })
            except Exception as e:
                self._respond_json(503, {"status": "error", "error": "Database engine unavailable"})

        elif path == "/info":
            try:
                raw = execute_tcp("INFO", timeout=4.0)
                idx = raw.find("{")
                data = json.loads(raw[idx:]) if idx != -1 else {"raw": raw.strip()}
                self._respond_json(200, data)
            except Exception:
                self._respond_json(500, {"error": "Failed to fetch engine info"})

        elif path == "/schema":
            query_params = {}
            if "?" in self.path:
                for part in self.path.split("?")[1].split("&"):
                    if "=" in part:
                        k, v = part.split("=", 1)
                        query_params[k] = v
            table = query_params.get("table", "").strip()
            if table and not TABLE_NAME_REGEX.match(table):
                self._respond_json(400, {"error": "Invalid table name format"})
                return

            cmd = f"SCHEMA {table}".strip()
            try:
                raw = execute_tcp(cmd, timeout=4.0)
                idx = raw.find("{")
                data = json.loads(raw[idx:]) if idx != -1 else {"raw": raw.strip()}
                self._respond_json(200, data)
            except Exception:
                self._respond_json(500, {"error": "Failed to inspect schema"})

        else:
            self._respond_json(404, {"error": "Endpoint not found"})

    def do_POST(self):
        if not self.check_rate_limit():
            return

        path = self.path.rstrip("/")

        # Enforce 100 KB payload size limit
        try:
            content_length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self._respond_json(400, {"error": "Invalid Content-Length header"})
            return

        if content_length > MAX_PAYLOAD_BYTES:
            self._respond_json(
                413,
                {
                    "status": "error",
                    "code": 413,
                    "error": "Payload Too Large",
                    "message": f"Payload size ({content_length} bytes) exceeds maximum limit of {MAX_PAYLOAD_BYTES} bytes (100 KB).",
                    "max_allowed_bytes": MAX_PAYLOAD_BYTES,
                }
            )
            return

        # Safe read capped at MAX_PAYLOAD_BYTES + 1
        raw_body = self.rfile.read(min(content_length, MAX_PAYLOAD_BYTES + 1)).decode("utf-8", errors="ignore")
        if len(raw_body.encode("utf-8")) > MAX_PAYLOAD_BYTES:
            self._respond_json(413, {"error": "Payload Too Large", "message": "Exceeded 100 KB limit"})
            return

        try:
            payload = json.loads(raw_body) if raw_body else {}
        except Exception:
            self._respond_json(400, {"error": "Malformed JSON in request body"})
            return

        if path == "/query":
            query_str = payload.get("query", "").strip()
            if not query_str:
                self._respond_json(400, {"error": "Missing 'query' parameter"})
                return
            if len(query_str) > 4096:
                self._respond_json(400, {"error": "Query string too long (maximum 4096 characters)"})
                return

            try:
                raw = execute_tcp(f"QUERY {query_str}", timeout=10.0)
                idx = raw.find("{")
                data = json.loads(raw[idx:]) if idx != -1 else {"raw": raw.strip()}
                self._respond_json(200, data)
            except Exception as e:
                self._respond_json(500, {"error": f"Query execution error: {str(e)}"})

        elif path == "/push":
            if not self.check_auth():
                self._respond_json(401, {"error": "Unauthorized. Invalid or missing API Key"})
                return

            table = payload.get("table", "rides").strip()
            item = payload.get("payload", "").strip()

            if not TABLE_NAME_REGEX.match(table):
                self._respond_json(400, {"error": "Invalid table name. Only alphanumeric, underscores, and dashes allowed (max 64 chars)"})
                return

            if not item:
                self._respond_json(400, {"error": "Missing 'payload' parameter"})
                return

            try:
                raw = execute_tcp(f"PUSH {table} {item}", timeout=5.0)
                row_id = raw.strip().lstrip(":")
                self._respond_json(200, {"ok": True, "table": table, "rowId": row_id, "raw": raw.strip()})
            except Exception as e:
                self._respond_json(500, {"error": f"Ingestion error: {str(e)}"})

        elif path == "/flush":
            if not self.check_auth():
                self._respond_json(401, {"error": "Unauthorized. Invalid or missing API Key"})
                return

            try:
                raw = execute_tcp("FLUSH", timeout=5.0)
                self._respond_json(200, {"ok": True, "response": raw.strip()})
            except Exception as e:
                self._respond_json(500, {"error": f"Flush error: {str(e)}"})
        else:
            self._respond_json(404, {"error": "Endpoint not found"})

    def _respond_json(self, status: int, data: dict, remaining: int = None, retry_after: int = 0):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        rem = remaining if remaining is not None else getattr(self, "_current_remaining", RATE_LIMIT_MAX)
        self._send_security_headers(remaining=rem, retry_after=retry_after)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "7860"))
    print(f"[SECURITY] SynapseDB Hardened Gateway listening on http://0.0.0.0:{port}")
    print(f"   - Rate Limit: {RATE_LIMIT_MAX} req/min")
    print(f"   - Max Payload: {MAX_PAYLOAD_BYTES / 1024:.1f} KB")
    print(f"   - Auth Protected: {'Yes' if SYNAPSE_API_KEY else 'No (Public Demo Mode)'}")
    server = HTTPServer(("0.0.0.0", port), SynapseGatewayHandler)
    server.serve_forever()
