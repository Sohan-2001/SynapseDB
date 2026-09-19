export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const custom = localStorage.getItem("synapse_api_url");
    if (custom) return custom.replace(/\/$/, "");
  }
  return (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
}

export function setCustomApiUrl(url: string) {
  if (typeof window !== "undefined") {
    const envUrl = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
    if (url && url !== envUrl) {
      localStorage.setItem("synapse_api_url", url);
    } else {
      localStorage.removeItem("synapse_api_url");
    }
  }
}

export interface QueryResponse {
  status: "success" | "error";
  table?: string;
  columns?: string[];
  rows?: Record<string, any>[];
  row_count?: number;
  stats?: {
    chunks_scanned: number;
    chunks_pruned: number;
    execution_time_us: number;
  };
  error?: string;
  plan?: string;
  raw?: string;
}

export interface SchemaResponse {
  tables: string[];
  columns?: { id: number; name: string; type: string }[];
  row_count?: number;
  table?: string;
  error?: string;
  plan?: string;
}

export interface HealthResponse {
  status: string;
  engine?: string;
  ping?: string;
  error?: string;
  plan?: string;
}

export async function pingHealth(baseUrl = getApiBaseUrl()): Promise<{ ok: boolean; data?: HealthResponse; latencyMs: number }> {
  const start = performance.now();
  try {
    const res = await fetch(`${baseUrl}/health`, { method: "GET" });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { ok: true, data, latencyMs };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return { ok: false, data: { status: "offline", error: err.message }, latencyMs };
  }
}

export async function fetchSchema(table = "", baseUrl = getApiBaseUrl()): Promise<SchemaResponse> {
  const url = table ? `${baseUrl}/schema?table=${encodeURIComponent(table)}` : `${baseUrl}/schema`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch schema: HTTP ${res.status}`);
  return res.json();
}

export async function executeQuery(query: string, baseUrl = getApiBaseUrl()): Promise<QueryResponse> {
  const cleanQuery = query.trim();
  if (cleanQuery.length > 4096) {
    throw new Error("Query is too long (maximum 4096 characters allowed).");
  }

  const res = await fetch(`${baseUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: cleanQuery }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (res.status === 429) {
      throw new Error(err.message || "Server rate limit reached. Please wait a few seconds.");
    }
    if (res.status === 413) {
      throw new Error(err.message || "Payload too large. Exceeds 100 KB limit.");
    }
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function pushPayload(table: string, payload: string, baseUrl = getApiBaseUrl()) {
  const cleanTable = table.trim();
  if (!cleanTable || !/^[a-zA-Z0-9_-]{1,64}$/.test(cleanTable)) {
    throw new Error("Invalid table name. Only letters, numbers, hyphens, and underscores allowed (max 64 chars).");
  }

  // Pre-validate 100 KB limit client-side before sending across network
  const payloadBytes = new TextEncoder().encode(payload).length;
  if (payloadBytes > 100 * 1024) {
    throw new Error(`Payload size (${(payloadBytes / 1024).toFixed(1)} KB) exceeds the 100 KB security limit.`);
  }

  const res = await fetch(`${baseUrl}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table: cleanTable, payload }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (res.status === 429) {
      throw new Error(err.message || "Rate limit exceeded. Please wait a moment.");
    }
    if (res.status === 413) {
      throw new Error(err.message || "Payload too large. Exceeds 100 KB limit.");
    }
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function flushBuffers(baseUrl = getApiBaseUrl()) {
  const res = await fetch(`${baseUrl}/flush`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
