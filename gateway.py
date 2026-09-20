import os
import json
import time
import socket
import re
import hashlib
import secrets
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
            if now - self.last_cleanup > 300:
                self._cleanup(now)
                self.last_cleanup = now

            window_start = now - self.window_seconds
            timestamps = self.requests[ip]
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
auth_limiter = SlidingWindowRateLimiter(15, 60)  # Brute-force guard: max 15 attempts / min

# -------------------------------------------------------------
# User Store & Authentication System
# -------------------------------------------------------------
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
users_lock = Lock()

def _ensure_data_dir():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        if not os.path.exists(USERS_FILE):
            with open(USERS_FILE, "w", encoding="utf-8") as f:
                json.dump({}, f)
    except Exception as e:
        print(f"[AUTH WARN] Could not init users dir: {e}")

_ensure_data_dir()

def load_users() -> dict:
    with users_lock:
        try:
            if os.path.exists(USERS_FILE):
                with open(USERS_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return {}

def save_users(users: dict):
    with users_lock:
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(USERS_FILE, "w", encoding="utf-8") as f:
                json.dump(users, f, indent=2)
        except Exception as e:
            print(f"[AUTH ERROR] Failed to save users: {e}")

def hash_password(password: str, salt_hex: str) -> str:
    salt_bytes = bytes.fromhex(salt_hex)
    pwd_bytes = password.encode("utf-8")
    return hashlib.pbkdf2_hmac("sha256", pwd_bytes, salt_bytes, 100000).hex()

# Thread-safe in-memory session store (token -> {user_id, name, email, created_at, expires_at})
sessions_lock = Lock()
active_sessions: dict[str, dict] = {}
SESSION_TTL_SECONDS = 7 * 24 * 3600  # 7 days

def create_session(user_id: str, name: str, email: str) -> str:
    token = "syn_" + secrets.token_hex(24)
    now = time.time()
    with sessions_lock:
        active_sessions[token] = {
            "user_id": user_id,
            "name": name,
            "email": email,
            "created_at": now,
            "expires_at": now + SESSION_TTL_SECONDS
        }
    return token

def get_session_user(token: str) -> dict | None:
    if not token:
        return None
    now = time.time()
    with sessions_lock:
        sess = active_sessions.get(token)
        if not sess:
            return None
        if sess["expires_at"] < now:
            del active_sessions[token]
            return None
        return {
            "id": sess["user_id"],
            "name": sess["name"],
            "email": sess["email"]
        }

def revoke_session(token: str):
    with sessions_lock:
        if token in active_sessions:
            del active_sessions[token]

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
# HTTP Request Handler with Security & Authentication
# -------------------------------------------------------------
class SynapseGatewayHandler(BaseHTTPRequestHandler):
    def get_client_ip(self) -> str:
        forwarded = self.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def _send_security_headers(self, remaining: int = 60, retry_after: int = 0):
        self.send_header("Access-Control-Allow-Origin", CORS_ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-XSS-Protection", "1; mode=block")
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
            except Exception:
                self._respond_json(503, {"status": "error", "error": "Database engine unavailable"})

        elif path == "/auth/me":
            auth_header = self.headers.get("Authorization", "").strip()
            token = ""
            if auth_header.startswith("Bearer "):
                token = auth_header[7:].strip()
            
            user = get_session_user(token)
            if not user:
                self._respond_json(401, {
                    "status": "error",
                    "error": "Unauthorized. Invalid or expired session token."
                })
                return
            
            self._respond_json(200, {
                "status": "success",
                "user": user
            })

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
                    "message": f"Payload size ({content_length} bytes) exceeds limit of {MAX_PAYLOAD_BYTES} bytes.",
                }
            )
            return

        raw_body = self.rfile.read(min(content_length, MAX_PAYLOAD_BYTES + 1)).decode("utf-8", errors="ignore")
        if len(raw_body.encode("utf-8")) > MAX_PAYLOAD_BYTES:
            self._respond_json(413, {"error": "Payload Too Large"})
            return

        try:
            payload = json.loads(raw_body) if raw_body else {}
        except Exception:
            self._respond_json(400, {"error": "Malformed JSON in request body"})
            return

        # ---------------------------------------------------------
        # AUTHENTICATION ROUTES
        # ---------------------------------------------------------
        if path == "/auth/register":
            name = str(payload.get("name", "")).strip()
            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", ""))

            if not name:
                self._respond_json(400, {"status": "error", "error": "Name is required"})
                return
            if not email or "@" not in email or "." not in email:
                self._respond_json(400, {"status": "error", "error": "A valid email address is required"})
                return
            if not password or len(password) < 6:
                self._respond_json(400, {"status": "error", "error": "Password must be at least 6 characters long"})
                return

            users = load_users()
            if email in users:
                self._respond_json(409, {"status": "error", "error": "An account with this email already exists"})
                return

            user_id = "usr_" + secrets.token_hex(6)
            salt = secrets.token_hex(16)
            pw_hash = hash_password(password, salt)
            now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            user_record = {
                "id": user_id,
                "name": name,
                "email": email,
                "salt": salt,
                "password_hash": pw_hash,
                "created_at": now_iso
            }
            users[email] = user_record
            save_users(users)

            try:
                execute_tcp(f"PUSH _users {json.dumps({'user_id': user_id, 'email': email, 'name': name})}", timeout=1.0)
            except Exception:
                pass

            token = create_session(user_id, name, email)
            self._respond_json(201, {
                "status": "success",
                "user": {
                    "id": user_id,
                    "name": name,
                    "email": email,
                    "created_at": now_iso
                },
                "token": token
            })

        elif path == "/auth/login":
            ip = self.get_client_ip()
            allowed, _, retry_after = auth_limiter.is_allowed(ip)
            if not allowed:
                self._respond_json(429, {
                    "status": "error",
                    "error": f"Too many login attempts. Please wait {retry_after} seconds.",
                    "retry_after": retry_after
                }, retry_after=retry_after)
                return

            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", ""))

            if not email or not password:
                self._respond_json(400, {"status": "error", "error": "Email and password are required"})
                return

            users = load_users()
            user_record = users.get(email)
            if not user_record:
                self._respond_json(401, {"status": "error", "error": "No account found with this email"})
                return

            salt = user_record.get("salt", "")
            expected_hash = user_record.get("password_hash", "")
            computed_hash = hash_password(password, salt)

            if computed_hash != expected_hash:
                self._respond_json(401, {"status": "error", "error": "Incorrect password"})
                return

            user_id = user_record.get("id", "usr_unknown")
            name = user_record.get("name", "User")
            token = create_session(user_id, name, email)

            self._respond_json(200, {
                "status": "success",
                "user": {
                    "id": user_id,
                    "name": name,
                    "email": email,
                    "created_at": user_record.get("created_at", "")
                },
                "token": token
            })

        elif path == "/auth/logout":
            auth_header = self.headers.get("Authorization", "").strip()
            token = ""
            if auth_header.startswith("Bearer "):
                token = auth_header[7:].strip()
            if token:
                revoke_session(token)
            self._respond_json(200, {"status": "success", "message": "Signed out successfully"})

        elif path == "/auth/demo":
            guest_id = "guest_" + secrets.token_hex(4)
            guest_name = "Guest Explorer"
            guest_email = f"{guest_id}@synapsedb.demo"
            now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            token = create_session(guest_id, guest_name, guest_email)
            self._respond_json(200, {
                "status": "success",
                "user": {
                    "id": guest_id,
                    "name": guest_name,
                    "email": guest_email,
                    "created_at": now_iso
                },
                "token": token
            })

        # ---------------------------------------------------------
        # DATABASE ENGINE ROUTES
        # ---------------------------------------------------------
        elif path == "/query":
            query_str = payload.get("query", "").strip()
            if not query_str:
                self._respond_json(400, {"error": "Missing 'query' parameter"})
                return
            if len(query_str) > 4096:
                self._respond_json(400, {"error": "Query string too long (max 4096 chars)"})
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
                self._respond_json(400, {"error": "Invalid table name format"})
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
    print(f"[SECURITY] SynapseDB Hardened Gateway with Backend Auth listening on http://0.0.0.0:{port}")
    print(f"   - Rate Limit: {RATE_LIMIT_MAX} req/min (Auth: 15 req/min)")
    print(f"   - Max Payload: {MAX_PAYLOAD_BYTES / 1024:.1f} KB")
    print(f"   - Endpoints: /health, /query, /push, /schema, /auth/register, /auth/login, /auth/me, /auth/demo")
    server = HTTPServer(("0.0.0.0", port), SynapseGatewayHandler)
    server.serve_forever()
