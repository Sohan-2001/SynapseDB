export const DEFAULT_API_URL = "https://synapsedb-api-fd3325cc9fd0.herokuapp.com";

export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const custom = localStorage.getItem("synapse_api_url");
    if (custom) return custom.replace(/\/$/, "");
  }
  return process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
}

export function setCustomApiUrl(url: string) {
  if (typeof window !== "undefined") {
    if (url && url !== DEFAULT_API_URL) {
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
  raw?: string;
}

export interface SchemaResponse {
  tables: string[];
  columns?: { id: number; name: string; type: string }[];
  row_count?: number;
  table?: string;
  error?: string;
}

export interface HealthResponse {
  status: string;
  engine?: string;
  ping?: string;
  error?: string;
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
  const res = await fetch(`${baseUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function pushPayload(table: string, payload: string, baseUrl = getApiBaseUrl()) {
  const res = await fetch(`${baseUrl}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function flushBuffers(baseUrl = getApiBaseUrl()) {
  const res = await fetch(`${baseUrl}/flush`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return res.json();
}
