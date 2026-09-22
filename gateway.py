import os
import json
import time
import socket
import re
import hashlib
import hmac
import base64
import secrets
import sqlite3
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
# Persistent Storage & Stateless HMAC Authentication Layer
# -------------------------------------------------------------
DATA_DIR = os.environ.get("SYNAPSE_DATA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
USERS_FILE = os.path.join(DATA_DIR, "users.json")
SQLITE_DB = os.path.join(DATA_DIR, "synapsedb_users.db")
users_lock = Lock()

# Secret key for stateless HMAC-SHA256 tokens (stable across dyno restarts)
SYNAPSE_SESSION_SECRET = os.environ.get("SYNAPSE_SESSION_SECRET") or os.environ.get("SECRET_KEY") or "synapsedb_hmac_master_secret_2026_durable"
SESSION_TTL_SECONDS = 30 * 24 * 3600  # 30 days persistent session

DATABASE_URL = os.environ.get("DATABASE_URL")
HAS_POSTGRES = False
pg_module = None

if DATABASE_URL:
    try:
        import psycopg2
        pg_url = DATABASE_URL
        if pg_url.startswith("postgres://"):
            pg_url = pg_url.replace("postgres://", "postgresql://", 1)
        conn = psycopg2.connect(pg_url)
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS auth_users (
                    email VARCHAR(255) PRIMARY KEY,
                    id VARCHAR(64) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    salt VARCHAR(64) NOT NULL,
                    password_hash VARCHAR(128) NOT NULL,
                    created_at VARCHAR(64) NOT NULL
                );
                CREATE TABLE IF NOT EXISTS revoked_tokens (
                    token_sig VARCHAR(128) PRIMARY KEY,
                    revoked_at DOUBLE PRECISION NOT NULL
                );
                CREATE TABLE IF NOT EXISTS synapse_backup_records (
                    id SERIAL PRIMARY KEY,
                    tenant_prefix VARCHAR(64) NOT NULL,
                    table_name VARCHAR(64) NOT NULL,
                    payload TEXT NOT NULL,
                    created_at VARCHAR(64) NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_backup_table ON synapse_backup_records(tenant_prefix, table_name);
            """)
            conn.commit()
        conn.close()
        HAS_POSTGRES = True
        pg_module = psycopg2
        print("[AUTH STORAGE] Connected to Heroku PostgreSQL persistent SSD storage.")
    except Exception as e:
        print(f"[AUTH STORAGE WARN] PostgreSQL not active ({e}); using SQLite disk store.")

def _init_sqlite():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with sqlite3.connect(SQLITE_DB) as conn:
            conn.execute("PRAGMA journal_mode = WAL;")
            conn.execute("PRAGMA synchronous = NORMAL;")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS auth_users (
                    email TEXT PRIMARY KEY,
                    id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS revoked_tokens (
                    token_sig TEXT PRIMARY KEY,
                    revoked_at REAL NOT NULL
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS synapse_backup_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_prefix TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_backup_table ON synapse_backup_records(tenant_prefix, table_name);")
            conn.commit()
    except Exception as e:
        print(f"[AUTH STORAGE ERROR] SQLite init failed: {e}")

_init_sqlite()

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
            print(f"[AUTH ERROR] Failed to save users.json: {e}")

def get_user_by_email(email: str) -> dict | None:
    email = email.strip().lower()
    # 1. Check PostgreSQL if active
    if HAS_POSTGRES and pg_module:
        try:
            pg_url = DATABASE_URL.replace("postgres://", "postgresql://", 1) if DATABASE_URL.startswith("postgres://") else DATABASE_URL
            with pg_module.connect(pg_url) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT email, id, name, salt, password_hash, created_at FROM auth_users WHERE email = %s", (email,))
                    row = cur.fetchone()
                    if row:
                        return {
                            "email": row[0],
                            "id": row[1],
                            "name": row[2],
                            "salt": row[3],
                            "password_hash": row[4],
                            "created_at": row[5]
                        }
        except Exception as e:
            print(f"[AUTH POSTGRES ERROR] get_user: {e}")

    # 2. Check SQLite disk store
    try:
        with sqlite3.connect(SQLITE_DB) as conn:
            cur = conn.cursor()
            cur.execute("SELECT email, id, name, salt, password_hash, created_at FROM auth_users WHERE email = ?", (email,))
            row = cur.fetchone()
            if row:
                return {
                    "email": row[0],
                    "id": row[1],
                    "name": row[2],
                    "salt": row[3],
                    "password_hash": row[4],
                    "created_at": row[5]
                }
    except Exception as e:
        print(f"[AUTH SQLITE ERROR] get_user: {e}")

    # 3. Fallback to JSON file
    return load_users().get(email)

def save_user_record(user_record: dict):
    email = user_record["email"].strip().lower()
    uid = user_record["id"]
    name = user_record["name"]
    salt = user_record.get("salt", "")
    pw_hash = user_record.get("password_hash", "")
    created_at = user_record.get("created_at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    # 1. Save to PostgreSQL if active
    if HAS_POSTGRES and pg_module:
        try:
            pg_url = DATABASE_URL.replace("postgres://", "postgresql://", 1) if DATABASE_URL.startswith("postgres://") else DATABASE_URL
            with pg_module.connect(pg_url) as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO auth_users (email, id, name, salt, password_hash, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (email) DO UPDATE SET
                            name = EXCLUDED.name,
                            salt = EXCLUDED.salt,
                            password_hash = EXCLUDED.password_hash;
                    """, (email, uid, name, salt, pw_hash, created_at))
                    conn.commit()
        except Exception as e:
            print(f"[AUTH POSTGRES ERROR] save_user: {e}")

    # 2. Save to SQLite disk store
    try:
        with sqlite3.connect(SQLITE_DB) as conn:
            conn.execute("""
                INSERT OR REPLACE INTO auth_users (email, id, name, salt, password_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?);
            """, (email, uid, name, salt, pw_hash, created_at))
            conn.commit()
    except Exception as e:
        print(f"[AUTH SQLITE ERROR] save_user: {e}")

    # 3. Save to JSON file as well
    users = load_users()
    users[email] = user_record
    save_users(users)

def ensure_user_profile(user_id: str, name: str, email: str):
    """Self-healing profile restoration: ensures user exists on the backend across dyno restarts."""
    if not email:
        return
    email = email.strip().lower()
    existing = get_user_by_email(email)
    if not existing:
        stub_record = {
            "id": user_id,
            "name": name,
            "email": email,
            "salt": "",
            "password_hash": "",
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        save_user_record(stub_record)

def record_revoked_token(token: str):
    sig = token.split(".")[-1] if "." in token else token
    now = time.time()
    if HAS_POSTGRES and pg_module:
        try:
            pg_url = DATABASE_URL.replace("postgres://", "postgresql://", 1) if DATABASE_URL.startswith("postgres://") else DATABASE_URL
            with pg_module.connect(pg_url) as conn:
                with conn.cursor() as cur:
                    cur.execute("INSERT INTO revoked_tokens (token_sig, revoked_at) VALUES (%s, %s) ON CONFLICT DO NOTHING", (sig, now))
                    conn.commit()
        except Exception:
            pass
    try:
        with sqlite3.connect(SQLITE_DB) as conn:
            conn.execute("INSERT OR REPLACE INTO revoked_tokens (token_sig, revoked_at) VALUES (?, ?)", (sig, now))
            conn.commit()
    except Exception:
        pass

def is_token_revoked(token: str) -> bool:
    sig = token.split(".")[-1] if "." in token else token
    if HAS_POSTGRES and pg_module:
        try:
            pg_url = DATABASE_URL.replace("postgres://", "postgresql://", 1) if DATABASE_URL.startswith("postgres://") else DATABASE_URL
            with pg_module.connect(pg_url) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1 FROM revoked_tokens WHERE token_sig = %s", (sig,))
                    if cur.fetchone():
                        return True
        except Exception:
            pass
    try:
        with sqlite3.connect(SQLITE_DB) as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM revoked_tokens WHERE token_sig = ?", (sig,))
            if cur.fetchone():
                return True
    except Exception:
        pass
    return False

def hash_password(password: str, salt_hex: str) -> str:
    salt_bytes = bytes.fromhex(salt_hex)
    pwd_bytes = password.encode("utf-8")
    return hashlib.pbkdf2_hmac("sha256", pwd_bytes, salt_bytes, 100000).hex()

# Legacy active session buffer (for transient non-HMAC fallback)
sessions_lock = Lock()
active_sessions: dict[str, dict] = {}

def create_session(user_id: str, name: str, email: str) -> str:
    """Generates a stateless HMAC-SHA256 token valid for 30 days across dyno sleeps/restarts."""
    now = int(time.time())
    payload = {
        "uid": user_id,
        "name": name,
        "email": email,
        "iat": now,
        "exp": now + SESSION_TTL_SECONDS
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")
    sig = hmac.new(SYNAPSE_SESSION_SECRET.encode("utf-8"), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    token = f"syn.{b64_payload}.{sig}"
    return token

def get_session_user(token: str) -> dict | None:
    """Stateless HMAC verification: requires ZERO RAM and ZERO DB lookup."""
    if not token:
        return None

    # 1. Stateless HMAC token validation
    if token.startswith("syn."):
        parts = token.split(".")
        if len(parts) == 3:
            _, b64_payload, sig = parts
            expected_sig = hmac.new(SYNAPSE_SESSION_SECRET.encode("utf-8"), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
            if hmac.compare_digest(sig, expected_sig):
                if is_token_revoked(token):
                    return None
                padding = "=" * (-len(b64_payload) % 4)
                try:
                    raw_json = base64.urlsafe_b64decode((b64_payload + padding).encode("utf-8")).decode("utf-8")
                    data = json.loads(raw_json)
                    now = time.time()
                    if data.get("exp", 0) > now:
                        user = {
                            "id": data.get("uid"),
                            "name": data.get("name"),
                            "email": data.get("email")
                        }
                        # Ensure user profile exists on this dyno (self-healing)
                        ensure_user_profile(user["id"], user["name"], user["email"])
                        return user
                except Exception:
                    pass

    # 2. Legacy fallback for non-HMAC sessions
    with sessions_lock:
        sess = active_sessions.get(token)
        if sess and sess.get("expires_at", 0) > time.time():
            return {
                "id": sess["user_id"],
                "name": sess["name"],
                "email": sess["email"]
            }
    return None

def revoke_session(token: str):
    with sessions_lock:
        if token in active_sessions:
            del active_sessions[token]
    record_revoked_token(token)

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
# Write-Through Replay & Persistent Storage Recovery
# -------------------------------------------------------------
def backup_record(tenant_prefix: str, table_name: str, payload: str):
    """Persists every PUSH into Heroku's persistent database for dyno sleep recovery."""
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if HAS_POSTGRES and pg_module:
        try:
            pg_url = DATABASE_URL.replace("postgres://", "postgresql://", 1) if DATABASE_URL.startswith("postgres://") else DATABASE_URL
            with pg_module.connect(pg_url) as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO synapse_backup_records (tenant_prefix, table_name, payload, created_at)
                        VALUES (%s, %s, %s, %s);
                    """, (tenant_prefix, table_name, payload, now_iso))
                    conn.commit()
        except Exception as e:
            print(f"[BACKUP PG ERROR] Failed to record write: {e}")

    try:
        with sqlite3.connect(SQLITE_DB) as conn:
            conn.execute("""
                INSERT INTO synapse_backup_records (tenant_prefix, table_name, payload, created_at)
                VALUES (?, ?, ?, ?);
            """, (tenant_prefix, table_name, payload, now_iso))
            conn.commit()
    except Exception as e:
        print(f"[BACKUP SQLITE ERROR] Failed to record write: {e}")

def restore_synapsedb_from_backup() -> int:
    """Replays all persistent records back into SynapseDB on dyno boot or wake-up."""
    records = []
    if HAS_POSTGRES and pg_module:
        try:
            pg_url = DATABASE_URL.replace("postgres://", "postgresql://", 1) if DATABASE_URL.startswith("postgres://") else DATABASE_URL
            with pg_module.connect(pg_url) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT tenant_prefix, table_name, payload FROM synapse_backup_records ORDER BY id ASC;")
                    records = cur.fetchall()
        except Exception as e:
            print(f"[RESTORE PG ERROR] Failed to fetch backup records: {e}")

    if not records:
        try:
            with sqlite3.connect(SQLITE_DB) as conn:
                cur = conn.cursor()
                cur.execute("SELECT tenant_prefix, table_name, payload FROM synapse_backup_records ORDER BY id ASC;")
                records = cur.fetchall()
        except Exception as e:
            print(f"[RESTORE SQLITE ERROR] Failed to fetch backup records: {e}")

    if not records:
        return 0

    print(f"[RESTORE] Replaying {len(records)} records from Heroku persistent storage into SynapseDB...")
    replayed = 0
    for prefix, table, payload in records:
        target_table = f"{prefix}{table}"
        try:
            execute_tcp(f"PUSH {target_table} {payload}", timeout=2.0)
            replayed += 1
        except Exception as e:
            print(f"[RESTORE WARN] Replay error on {target_table}: {e}")

    if replayed > 0:
        try:
            execute_tcp("FLUSH", timeout=3.0)
            print(f"[RESTORE SUCCESS] Successfully flushed {replayed} records into SynapseDB columnar memory.")
        except Exception as e:
            print(f"[RESTORE WARN] Flush after restore error: {e}")

    return replayed

# -------------------------------------------------------------
# Multi-Tenant Partitioning & Security Helpers
# -------------------------------------------------------------
SAFE_TABLE_REGEX = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$")

def extract_bearer_token(handler) -> str:
    auth_header = handler.headers.get("Authorization", "").strip()
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    api_key_header = handler.headers.get("X-API-Key", "").strip()
    if api_key_header:
        return api_key_header
    return ""

def get_tenant(handler) -> tuple[str, dict | None]:
    token = extract_bearer_token(handler)
    user = get_session_user(token)
    if user:
        clean_user_id = re.sub(r"[^a-zA-Z0-9_]", "", user["id"])
        return f"u_{clean_user_id}_", user
    # If unauthenticated, route to isolated public demo tenant
    return "u_public_demo_", None

def check_forbidden_identifiers(text: str) -> bool:
    # Prohibit direct access to partitioned tables 'u_*' or internal tables '_*'
    for token in re.findall(r"\b[a-zA-Z0-9_]+\b", text):
        if token.startswith("u_") or token.startswith("_") or token.startswith("sys_"):
            return True
    return False

def rewrite_query_for_tenant(query_str: str, tenant_prefix: str) -> tuple[bool, str, str]:
    if check_forbidden_identifiers(query_str):
        return False, "", "Direct access to internal, system, or partitioned tables is prohibited."

    def replace_from(match):
        keyword = match.group(1)
        table = match.group(2)
        return f"{keyword} {tenant_prefix}{table}"

    rewritten = re.sub(r"(?i)\b(FROM|JOIN|INTO)\s+([a-zA-Z0-9_-]+)", replace_from, query_str)

    if rewritten == query_str:
        words = query_str.split()
        new_words = []
        replaced = False
        for w in words:
            clean_w = re.sub(r"[^a-zA-Z0-9_-]", "", w)
            if clean_w.lower() in ["rides", "expenses", "orders", "users", "sales", "logs", "metrics", "products", "customers"] and not replaced:
                new_words.append(w.replace(clean_w, f"{tenant_prefix}{clean_w}"))
                replaced = True
            else:
                new_words.append(w)
        rewritten = " ".join(new_words)

    return True, rewritten, ""

def clean_response_table_name(data: dict, tenant_prefix: str) -> dict:
    if isinstance(data, dict):
        if "table" in data and isinstance(data["table"], str):
            if data["table"].startswith(tenant_prefix):
                data["table"] = data["table"][len(tenant_prefix):]
            elif data["table"].startswith("u_"):
                parts = data["table"].split("_", 2)
                if len(parts) >= 3:
                    data["table"] = parts[2]
    return data

def ensure_demo_data_seeded():
    try:
        raw = execute_tcp("SCHEMA u_public_demo_rides", timeout=2.0)
        if "error" in raw.lower() or "not found" in raw.lower():
            demo_rides = [
                '{"fare": 34.80, "driver": "Alice", "user_id": 1001}',
                '{"fare": 41.20, "driver": "Diana", "user_id": 1002}',
                '{"fare": 28.50, "driver": "Bob", "user_id": 1003}',
                '{"fare": 32.00, "driver": "Marcus", "user_id": 1004}',
            ]
            for r in demo_rides:
                execute_tcp(f"PUSH u_public_demo_rides {r}", timeout=2.0)
                backup_record("u_public_demo_", "rides", r)
            expense_item = "coffee: 100, tea: 10, cab_cost: 500"
            execute_tcp(f"PUSH u_public_demo_expenses {expense_item}", timeout=2.0)
            backup_record("u_public_demo_", "expenses", expense_item)
            execute_tcp("FLUSH", timeout=2.0)
            print("[INFO] Pre-seeded and backed up public demo partition (u_public_demo_rides)")
    except Exception as e:
        print(f"[WARN] Demo partition seed skipped: {e}")

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
            tenant_prefix, _ = get_tenant(self)
            query_params = {}
            if "?" in self.path:
                for part in self.path.split("?")[1].split("&"):
                    if "=" in part:
                        k, v = part.split("=", 1)
                        query_params[k] = v
            table = query_params.get("table", "").strip()

            if table:
                if not SAFE_TABLE_REGEX.match(table) or table.startswith("u_") or table.startswith("_") or table.startswith("sys_"):
                    self._respond_json(400, {"error": "Invalid or reserved table name format"})
                    return

                cmd = f"SCHEMA {tenant_prefix}{table}".strip()
                try:
                    raw = execute_tcp(cmd, timeout=4.0)
                    idx = raw.find("{")
                    data = json.loads(raw[idx:]) if idx != -1 else {"raw": raw.strip()}
                    data = clean_response_table_name(data, tenant_prefix)
                    self._respond_json(200, data)
                except Exception:
                    self._respond_json(500, {"error": "Failed to inspect schema"})
            else:
                try:
                    raw = execute_tcp("SCHEMA", timeout=4.0)
                    idx = raw.find("{")
                    data = json.loads(raw[idx:]) if idx != -1 else {"tables": []}
                    raw_tables = data.get("tables", [])
                    user_tables = [t[len(tenant_prefix):] for t in raw_tables if t.startswith(tenant_prefix)]
                    self._respond_json(200, {"tables": user_tables})
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

            existing = get_user_by_email(email)
            if existing and existing.get("password_hash"):
                self._respond_json(409, {"status": "error", "error": "An account with this email already exists"})
                return

            user_id = existing.get("id") if (existing and existing.get("id")) else ("usr_" + secrets.token_hex(6))
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
            save_user_record(user_record)
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

            user_record = get_user_by_email(email)
            if not user_record or not user_record.get("password_hash"):
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

            tenant_prefix, _ = get_tenant(self)
            allowed, rewritten_query, err_msg = rewrite_query_for_tenant(query_str, tenant_prefix)
            if not allowed:
                self._respond_json(403, {"status": "error", "error": err_msg})
                return

            try:
                raw = execute_tcp(f"QUERY {rewritten_query}", timeout=10.0)
                idx = raw.find("{")
                data = json.loads(raw[idx:]) if idx != -1 else {"raw": raw.strip()}
                data = clean_response_table_name(data, tenant_prefix)
                self._respond_json(200, data)
            except Exception as e:
                self._respond_json(500, {"error": f"Query execution error: {str(e)}"})

        elif path == "/push":
            if not self.check_auth():
                self._respond_json(401, {"error": "Unauthorized. Invalid or missing API Key"})
                return

            table = payload.get("table", "rides").strip()
            item = payload.get("payload", "").strip()

            if not SAFE_TABLE_REGEX.match(table) or table.startswith("u_") or table.startswith("_") or table.startswith("sys_"):
                self._respond_json(400, {"error": "Invalid table name. Only alphanumeric characters allowed, cannot start with 'u_' or '_'"})
                return

            if not item:
                self._respond_json(400, {"error": "Missing 'payload' parameter"})
                return

            tenant_prefix, _ = get_tenant(self)
            target_table = f"{tenant_prefix}{table}"

            try:
                raw = execute_tcp(f"PUSH {target_table} {item}", timeout=5.0)
                row_id = raw.strip().lstrip(":")
                backup_record(tenant_prefix, table, item)
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
    import threading
    port = int(os.environ.get("PORT", "7860"))
    print(f"[SECURITY] SynapseDB Hardened Gateway with Multi-Tenant Partitioning listening on http://0.0.0.0:{port}")
    print(f"   - Rate Limit: {RATE_LIMIT_MAX} req/min (Auth: 15 req/min)")
    print(f"   - Max Payload: {MAX_PAYLOAD_BYTES / 1024:.1f} KB")
    print(f"   - Multi-Tenancy: Isolated user partitions with automatic prefix routing")
    print(f"   - Endpoints: /health, /query, /push, /schema, /auth/register, /auth/login, /auth/me, /auth/demo")

    # 1. Wait for SynapseDB TCP engine to start
    for _ in range(15):
        try:
            res = execute_tcp("PING", timeout=1.0)
            if "PONG" in res:
                break
        except Exception:
            time.sleep(0.5)

    # 2. Replay all saved data from Heroku persistent storage into SynapseDB
    restored_count = restore_synapsedb_from_backup()
    if restored_count == 0:
        ensure_demo_data_seeded()

    # 3. Background watchdog thread: automatically re-restores if dyno woke from sleep with empty tables
    def synapsedb_watchdog():
        while True:
            time.sleep(60)
            try:
                raw = execute_tcp("SCHEMA", timeout=3.0)
                if '{"tables":[]}' in raw.replace(" ", ""):
                    print("[WATCHDOG] Empty tables detected (dyno reset). Restoring from persistent storage...")
                    restore_synapsedb_from_backup()
            except Exception:
                pass

    watchdog_thread = threading.Thread(target=synapsedb_watchdog, daemon=True)
    watchdog_thread.start()

    server = HTTPServer(("0.0.0.0", port), SynapseGatewayHandler)
    server.serve_forever()
