"use client";

import React, { useState, useEffect } from "react";
import {
  Database,
  Terminal,
  Play,
  Send,
  Table as TableIcon,
  Zap,
  CheckCircle2,
  AlertCircle,
  Download,
  Copy,
  RefreshCw,
  ExternalLink,
  BookOpen,
  Layers,
  Search,
  Sparkles,
  Settings2,
} from "lucide-react";
import {
  getApiBaseUrl,
  setCustomApiUrl,
  pingHealth,
  fetchSchema,
  executeQuery,
  pushPayload,
  flushBuffers,
  QueryResponse,
  SchemaResponse,
} from "@/lib/api";

export default function SynapsePlayground() {
  const [activeTab, setActiveTab] = useState<"query" | "browser" | "ingest" | "docs">("query");
  const [apiUrl, setApiUrl] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pingLatency, setPingLatency] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState("Connecting...");

  // Query Studio State
  const [queryMode, setQueryMode] = useState<"SQL" | "NL">("SQL");
  const [queryText, setQueryText] = useState("SELECT COUNT(*), AVG(amount) FROM rides");
  const [isQueryRunning, setIsQueryRunning] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [resultViewMode, setResultViewMode] = useState<"table" | "json">("table");

  // Ingestion Lab State
  const [ingestTable, setIngestTable] = useState("rides");
  const [ingestPayloadText, setIngestPayloadText] = useState(
    JSON.stringify({ fare: 42.5, user_id: 1001, driver: "Alice" }, null, 2)
  );
  const [isPushing, setIsPushing] = useState(false);
  const [pushAck, setPushAck] = useState<any>(null);

  // Synthetic Generator State
  const [batchSize, setBatchSize] = useState(50);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStats, setGenStats] = useState<any>(null);

  // Data Browser State
  const [tablesList, setTablesList] = useState<string[]>([]);
  const [activeBrowserTable, setActiveBrowserTable] = useState<string | null>(null);
  const [browserData, setBrowserData] = useState<QueryResponse | null>(null);
  const [browserSearch, setBrowserSearch] = useState("");
  const [isBrowserLoading, setIsBrowserLoading] = useState(false);

  // Seed sample state
  const [isSeeding, setIsSeeding] = useState(false);

  useEffect(() => {
    const savedUrl = getApiBaseUrl();
    setApiUrl(savedUrl);
    checkHealth(savedUrl);
    const interval = setInterval(() => checkHealth(savedUrl), 8000);
    return () => clearInterval(interval);
  }, []);

  async function checkHealth(url = apiUrl) {
    const res = await pingHealth(url);
    setConnected(res.ok);
    setPingLatency(res.latencyMs);
    if (res.ok) {
      setStatusMsg("Connected to SynapseDB Cloud");
      loadSchema(url);
    } else {
      setStatusMsg("Connecting to Cloud Backend...");
    }
  }

  async function loadSchema(url = apiUrl) {
    try {
      const data = await fetchSchema("", url);
      if (data.tables) {
        setTablesList(data.tables);
        if (!activeBrowserTable && data.tables.length > 0) {
          setActiveBrowserTable(data.tables[0]);
          loadBrowserTable(data.tables[0], url);
        }
      }
    } catch (_) {}
  }

  async function handleRunQuery() {
    if (!queryText.trim()) return;
    setIsQueryRunning(true);
    setQueryError(null);
    try {
      const res = await executeQuery(queryText, apiUrl);
      if (res.status === "error") {
        setQueryError(res.error || "Query failed");
        setQueryResult(null);
      } else {
        setQueryResult(res);
      }
    } catch (err: any) {
      setQueryError(err.message || "Failed to execute query");
      setQueryResult(null);
    } finally {
      setIsQueryRunning(false);
    }
  }

  async function handlePush() {
    const table = ingestTable.trim() || "rides";
    const payload = ingestPayloadText.trim();
    if (!payload) return;

    setIsPushing(true);
    setPushAck(null);

    try {
      let items: string[] = [];
      if (payload.startsWith("[") && payload.endsWith("]")) {
        try {
          const parsed = JSON.parse(payload);
          if (Array.isArray(parsed)) {
            items = parsed.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
          }
        } catch (_) {}
      }

      if (items.length > 1) {
        const rowIds: string[] = [];
        for (const it of items) {
          const res = await pushPayload(table, it, apiUrl);
          if (res.rowId) rowIds.push(res.rowId);
        }
        await flushBuffers(apiUrl);
        setPushAck({
          title: `BATCH ACK (${items.length} Records)`,
          rowId: `#${rowIds[0]} - #${rowIds[rowIds.length - 1]}`,
          detail: "Appended to WAL & flushed to Columnar storage",
        });
      } else {
        const res = await pushPayload(table, payload, apiUrl);
        await flushBuffers(apiUrl);
        setPushAck({
          title: "WAL DURABLE ACK",
          rowId: `#${res.rowId || "--"}`,
          detail: "fsynced to active.wal and drained to Columnar",
        });
      }
      loadSchema(apiUrl);
      if (activeBrowserTable === table) loadBrowserTable(table, apiUrl);
    } catch (err: any) {
      alert(`Push error: ${err.message}`);
    } finally {
      setIsPushing(false);
    }
  }

  async function handleGenerateBatch() {
    setIsGenerating(true);
    setGenProgress(0);
    setGenStats(null);
    const table = ingestTable.trim() || "rides";
    const drivers = ["Alice", "Bob", "Charlie", "Diana", "Marcus", "Elena"];
    const latencies: number[] = [];

    try {
      for (let i = 1; i <= batchSize; i++) {
        const start = performance.now();
        const r = i % 3;
        let payload = "";
        if (r === 0) {
          payload = JSON.stringify({
            fare: +(15 + (i % 40) * 2.2).toFixed(2),
            user_id: 1000 + i,
            driver: drivers[i % drivers.length],
          });
        } else if (r === 1) {
          payload = JSON.stringify({
            cost: +(12 + (i % 30) * 1.8).toFixed(2),
            user_id: 2000 + i,
            driver: "SynonymDriver",
          });
        } else {
          payload = `cost: ${(20 + (i % 50) * 1.5).toFixed(2)}, driver: ${drivers[i % drivers.length]}, status: completed`;
        }

        await pushPayload(table, payload, apiUrl);
        latencies.push(performance.now() - start);
        setGenProgress(Math.round((i / batchSize) * 100));
      }

      await flushBuffers(apiUrl);
      latencies.sort((a, b) => a - b);
      const median = latencies[Math.floor(latencies.length / 2)] || 0;
      setGenStats({
        total: batchSize,
        median: `${median.toFixed(1)} ms`,
        status: "Flushed to Columnar",
      });
      loadSchema(apiUrl);
      if (activeBrowserTable === table) loadBrowserTable(table, apiUrl);
    } catch (err: any) {
      alert(`Generator error: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  }

  async function loadBrowserTable(tableName: string, url = apiUrl) {
    setIsBrowserLoading(true);
    setActiveBrowserTable(tableName);
    try {
      const res = await executeQuery(`SELECT * FROM ${tableName} LIMIT 100`, url);
      setBrowserData(res);
    } catch (err) {
      setBrowserData(null);
    } finally {
      setIsBrowserLoading(false);
    }
  }

  async function seedSampleData() {
    setIsSeeding(true);
    try {
      const seedRides = [
        { fare: 32.5, driver: "Alice", user_id: 1001 },
        { fare: 48.0, driver: "Bob", user_id: 1002 },
        { fare: 19.75, driver: "Charlie", user_id: 1003 },
        { fare: 55.2, driver: "Diana", user_id: 1004 },
        { fare: 27.8, driver: "Marcus", user_id: 1005 },
      ];
      for (const r of seedRides) {
        await pushPayload("rides", JSON.stringify(r), apiUrl);
      }
      await pushPayload("expenses", "coffee: 100, tea: 10, cab_cost: 500", apiUrl);
      await flushBuffers(apiUrl);
      await loadSchema(apiUrl);
      alert("Sample data seeded successfully!");
      if (activeBrowserTable) loadBrowserTable(activeBrowserTable, apiUrl);
    } catch (err: any) {
      alert(`Seeding failed: ${err.message}`);
    } finally {
      setIsSeeding(false);
    }
  }

  function exportCSV() {
    if (!browserData || !browserData.rows || browserData.rows.length === 0) return;
    const cols = browserData.columns || Object.keys(browserData.rows[0]);
    const lines = [cols.join(",")];
    for (const row of browserData.rows) {
      lines.push(cols.map((c) => JSON.stringify(row[c] ?? "")).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeBrowserTable || "data"}.csv`;
    a.click();
  }

  function exportJSON() {
    if (!browserData || !browserData.rows) return;
    const blob = new Blob([JSON.stringify(browserData.rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeBrowserTable || "data"}.json`;
    a.click();
  }

  const filteredBrowserRows = (browserData?.rows || []).filter((r) => {
    if (!browserSearch.trim()) return true;
    const s = browserSearch.toLowerCase();
    return Object.values(r).some((v) => String(v).toLowerCase().includes(s));
  });

  return (
    <div className="min-h-screen bg-[#0a0d14] text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-[#1e2638] bg-[#0c101a] px-6 py-3.5 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20">
              <Zap className="w-5 h-5 text-white fill-current" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">SynapseDB</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              Playground
            </span>
          </div>

          {/* Connection Status Pill */}
          <div
            onClick={() => setShowConfig(!showConfig)}
            className="hidden md:flex items-center gap-2 ml-4 px-3 py-1 rounded-full bg-[#131926] border border-[#1e2638] text-xs cursor-pointer hover:border-slate-600 transition"
            title="Click to change backend endpoint"
          >
            <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            <span className="text-slate-300 font-medium">{statusMsg}</span>
            {pingLatency !== null && <span className="text-slate-500 text-[11px]">({pingLatency} ms)</span>}
            <Settings2 className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 ml-1" />
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={seedSampleData}
            disabled={isSeeding}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isSeeding ? "Seeding..." : "Seed Sample Data"}</span>
          </button>

          <a
            href="https://github.com/Sohan-2001/SynapseDB"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#1a2233] hover:bg-[#253047] text-slate-200 border border-[#2a3752] font-medium transition"
          >
            <span>GitHub</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </a>
        </div>
      </header>

      {/* Endpoint Config Dropdown Modal */}
      {showConfig && (
        <div className="bg-[#0f1422] border-b border-[#1e2638] px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <span className="text-slate-400 font-medium whitespace-nowrap">Cloud Backend URL:</span>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              className="flex-1 bg-[#090d16] border border-[#1e2638] rounded px-2.5 py-1 text-slate-200 font-mono text-xs focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => {
                setCustomApiUrl(apiUrl);
                checkHealth(apiUrl);
                setShowConfig(false);
              }}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
            >
              Apply
            </button>
            <button
              onClick={() => {
                const envUrl = process.env.NEXT_PUBLIC_API_URL || "";
                setApiUrl(envUrl);
                setCustomApiUrl("");
                checkHealth(envUrl);
                setShowConfig(false);
              }}
              className="text-slate-400 hover:text-slate-200 underline"
            >
              Reset to .env
            </button>
          </div>
          <span className="text-slate-500 text-[11px]">
            Configured via <code>NEXT_PUBLIC_API_URL</code> environment variable
          </span>
        </div>
      )}

      {/* Main App Container */}
      <div className="flex-1 flex flex-col max-w-7xl w-full mx-auto p-4 md:p-6 gap-6">
        {/* Navigation Tabs */}
        <div className="flex border-b border-[#1e2638] gap-1">
          <button
            onClick={() => setActiveTab("query")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
              activeTab === "query"
                ? "border-blue-500 text-blue-400 bg-blue-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Search className="w-4 h-4" />
            <span>Query Studio</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("browser");
              if (activeBrowserTable) loadBrowserTable(activeBrowserTable);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
              activeTab === "browser"
                ? "border-blue-500 text-blue-400 bg-blue-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <TableIcon className="w-4 h-4" />
            <span>Data Browser</span>
          </button>
          <button
            onClick={() => setActiveTab("ingest")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
              activeTab === "ingest"
                ? "border-blue-500 text-blue-400 bg-blue-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Download className="w-4 h-4" />
            <span>Ingestion Lab</span>
          </button>
          <button
            onClick={() => setActiveTab("docs")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
              activeTab === "docs"
                ? "border-blue-500 text-blue-400 bg-blue-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Syntax & Rules</span>
          </button>
        </div>

        {/* ========================================================= */}
        {/* TAB 1: QUERY STUDIO                                       */}
        {/* ========================================================= */}
        {activeTab === "query" && (
          <div className="flex flex-col gap-5">
            {/* Header & Mode Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white">Query Studio</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Execute vectorized SQL or Natural Language queries compiled by our CPU-hosted SLM
                </p>
              </div>

              {/* Mode Toggle */}
              <div className="flex bg-[#0f1422] p-1 rounded-lg border border-[#1e2638]">
                <button
                  onClick={() => {
                    setQueryMode("SQL");
                    setQueryText("SELECT COUNT(*), AVG(amount) FROM rides");
                  }}
                  className={`px-3 py-1 rounded text-xs font-semibold transition ${
                    queryMode === "SQL" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Direct SQL
                </button>
                <button
                  onClick={() => {
                    setQueryMode("NL");
                    setQueryText("Total rides where amount > 30");
                  }}
                  className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1 transition ${
                    queryMode === "NL" ? "bg-purple-600 text-white shadow" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Sparkles className="w-3 h-3 text-purple-300" />
                  <span>Natural Language (SLM)</span>
                </button>
              </div>
            </div>

            {/* Example Query Chips */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="text-slate-500 self-center text-[11px] font-medium mr-1">Quick Queries:</span>
              {[
                "SELECT COUNT(*), AVG(amount) FROM rides",
                "SELECT * FROM rides WHERE amount > 30",
                "Total rides where amount > 30",
                "Average fare in rides",
                "SELECT * FROM expenses",
              ].map((chip) => (
                <button
                  key={chip}
                  onClick={() => {
                    setQueryText(chip);
                    if (chip.toLowerCase().startsWith("select")) setQueryMode("SQL");
                    else setQueryMode("NL");
                  }}
                  className="px-2.5 py-1 rounded-md bg-[#131927] border border-[#1e2638] text-slate-300 hover:border-blue-500/50 hover:text-blue-300 transition font-mono text-[11px]"
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Code Editor Box */}
            <div className="bg-[#0c101a] border border-[#1e2638] rounded-xl overflow-hidden shadow-xl flex flex-col">
              <textarea
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    handleRunQuery();
                  }
                }}
                rows={3}
                placeholder={
                  queryMode === "SQL"
                    ? "Enter SQL: SELECT * FROM rides WHERE amount > 25"
                    : "Enter plain English: Average fare in rides where amount > 30"
                }
                className="w-full bg-[#0c101a] text-slate-100 font-mono text-sm p-4 focus:outline-none resize-none border-b border-[#1e2638]/70"
              />

              <div className="bg-[#0f1422] px-4 py-2.5 flex items-center justify-between">
                <span className="text-slate-500 text-xs flex items-center gap-1.5">
                  Press <kbd className="px-1.5 py-0.5 rounded bg-[#1e2638] text-slate-300 text-[10px] font-mono">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded bg-[#1e2638] text-slate-300 text-[10px] font-mono">Enter</kbd> to execute
                </span>

                <button
                  onClick={handleRunQuery}
                  disabled={isQueryRunning}
                  className="flex items-center gap-2 px-5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 transition disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isQueryRunning ? "Running..." : "Run Query"}</span>
                </button>
              </div>
            </div>

            {/* Error Display */}
            {queryError && (
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <strong className="font-semibold block mb-0.5">Execution Error:</strong>
                  <span>{queryError}</span>
                </div>
              </div>
            )}

            {/* Query Results & Metrics Card */}
            {queryResult && (
              <div className="bg-[#0f1422] border border-[#1e2638] rounded-xl overflow-hidden shadow-xl flex flex-col gap-3 p-4">
                {/* Stats Bar */}
                <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#1e2638] gap-4">
                  <div className="flex items-center gap-6 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase font-semibold">Status</span>
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> 200 OK
                      </span>
                    </div>
                    {queryResult.stats && (
                      <>
                        <div>
                          <span className="text-slate-500 block text-[10px] uppercase font-semibold">Engine Latency</span>
                          <span className="text-blue-400 font-mono font-bold">
                            {queryResult.stats.execution_time_us} μs
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px] uppercase font-semibold">Chunks Scanned</span>
                          <span className="text-slate-300 font-mono font-bold">
                            {queryResult.stats.chunks_scanned} chunk ({queryResult.stats.chunks_pruned} pruned)
                          </span>
                        </div>
                      </>
                    )}
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase font-semibold">Rows Matched</span>
                      <span className="text-slate-200 font-mono font-bold">{queryResult.row_count ?? (queryResult.rows?.length || 0)}</span>
                    </div>
                  </div>

                  {/* Toggle View Mode */}
                  <div className="flex bg-[#0c101a] p-0.5 rounded border border-[#1e2638] text-xs">
                    <button
                      onClick={() => setResultViewMode("table")}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                        resultViewMode === "table" ? "bg-[#1e2638] text-blue-400" : "text-slate-400"
                      }`}
                    >
                      Table View
                    </button>
                    <button
                      onClick={() => setResultViewMode("json")}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                        resultViewMode === "json" ? "bg-[#1e2638] text-blue-400" : "text-slate-400"
                      }`}
                    >
                      Raw JSON
                    </button>
                  </div>
                </div>

                {/* Table View */}
                {resultViewMode === "table" && queryResult.rows && queryResult.rows.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-[#1e2638]/70">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#121826] text-slate-300 font-mono text-[11px] border-b border-[#1e2638]">
                          {(queryResult.columns || Object.keys(queryResult.rows[0])).map((col) => (
                            <th key={col} className="p-2.5 font-semibold">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1e2638]/40 font-mono">
                        {queryResult.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-blue-500/5 transition">
                            {(queryResult.columns || Object.keys(queryResult.rows![0])).map((col) => {
                              const val = row[col];
                              return (
                                <td key={col} className="p-2.5 text-slate-300">
                                  {val === null ? (
                                    <span className="text-slate-600 italic">null</span>
                                  ) : typeof val === "number" ? (
                                    <span className="text-emerald-400">{val}</span>
                                  ) : typeof val === "boolean" ? (
                                    <span className="text-amber-400">{String(val)}</span>
                                  ) : (
                                    String(val)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* JSON View */}
                {resultViewMode === "json" && (
                  <div className="relative">
                    <pre className="bg-[#090d16] p-3.5 rounded-lg font-mono text-xs text-blue-300 max-h-96 overflow-y-auto border border-[#1e2638]">
                      {JSON.stringify(queryResult, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: DATA BROWSER                                       */}
        {/* ========================================================= */}
        {activeTab === "browser" && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">Data Browser</h2>
              <p className="text-xs text-slate-400 mt-0.5">Live inspection of all tables, dynamic columns, and persisted rows</p>
            </div>

            {/* Table Selection Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 text-xs font-medium">Tables:</span>
              {tablesList.length === 0 ? (
                <span className="text-slate-500 text-xs italic">No tables created yet. Click Seed Sample Data!</span>
              ) : (
                tablesList.map((t) => (
                  <button
                    key={t}
                    onClick={() => loadBrowserTable(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                      activeBrowserTable === t
                        ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                        : "bg-[#121826] text-slate-300 border border-[#1e2638] hover:border-slate-600"
                    }`}
                  >
                    <TableIcon className="w-3.5 h-3.5" />
                    <span>{t}</span>
                  </button>
                ))
              )}
            </div>

            {/* Action Bar (Search & Export) */}
            <div className="bg-[#0f1422] p-3 rounded-xl border border-[#1e2638] flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  value={browserSearch}
                  onChange={(e) => setBrowserSearch(e.target.value)}
                  placeholder={`Search rows in ${activeBrowserTable || "table"}...`}
                  className="w-full bg-[#090d16] border border-[#1e2638] rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={exportCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141b29] hover:bg-[#1a2335] text-slate-300 border border-[#1e2638] text-xs font-medium transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={exportJSON}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141b29] hover:bg-[#1a2335] text-slate-300 border border-[#1e2638] text-xs font-medium transition"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Export JSON</span>
                </button>
                <button
                  onClick={() => activeBrowserTable && loadBrowserTable(activeBrowserTable)}
                  className="p-1.5 rounded-lg bg-[#141b29] hover:bg-[#1a2335] text-slate-400 hover:text-slate-200 border border-[#1e2638] transition"
                  title="Refresh table data"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Table Display */}
            <div className="bg-[#0f1422] border border-[#1e2638] rounded-xl overflow-hidden shadow-xl">
              {isBrowserLoading ? (
                <div className="p-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                  <span>Scanning columnar storage...</span>
                </div>
              ) : filteredBrowserRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#121826] text-slate-300 font-mono text-[11px] border-b border-[#1e2638]">
                        {(browserData?.columns || Object.keys(filteredBrowserRows[0])).map((col) => (
                          <th key={col} className="p-3 font-semibold">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2638]/40 font-mono">
                      {filteredBrowserRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-blue-500/5 transition">
                          {(browserData?.columns || Object.keys(filteredBrowserRows[0])).map((col) => {
                            const val = row[col];
                            return (
                              <td key={col} className="p-3 text-slate-300">
                                {val === null ? (
                                  <span className="text-slate-600 italic">null</span>
                                ) : typeof val === "number" ? (
                                  <span className="text-emerald-400">{val}</span>
                                ) : (
                                  String(val)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-10 text-center text-xs text-slate-500">
                  No records found in table <strong>{activeBrowserTable}</strong>.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: INGESTION LAB                                      */}
        {/* ========================================================= */}
        {activeTab === "ingest" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#0f1422] border border-[#1e2638] rounded-xl p-5 flex flex-col gap-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">Custom Data Ingestion</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Push single JSON, multi-record batches, or key-value strings into the WAL
                  </p>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                  Zero-DDL
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Target Table</label>
                <input
                  type="text"
                  value={ingestTable}
                  onChange={(e) => setIngestTable(e.target.value)}
                  className="w-full bg-[#090d16] border border-[#1e2638] rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-400">Payload</label>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() =>
                        setIngestPayloadText(
                          JSON.stringify({ fare: +(20 + Math.random() * 80).toFixed(2), driver: "Alice", user_id: 1001 }, null, 2)
                        )
                      }
                      className="px-2 py-0.5 bg-[#141b29] hover:bg-blue-600 hover:text-white text-blue-400 text-[10px] rounded border border-[#1e2638] font-mono transition"
                    >
                      JSON Ride
                    </button>
                    <button
                      onClick={() =>
                        setIngestPayloadText(
                          JSON.stringify(
                            [
                              { fare: 32.5, driver: "Alice", user_id: 1010 },
                              { fare: 48.0, driver: "Bob", user_id: 1011 },
                              { fare: 19.75, driver: "Charlie", user_id: 1012 },
                            ],
                            null,
                            2
                          )
                        )
                      }
                      className="px-2 py-0.5 bg-[#141b29] hover:bg-blue-600 hover:text-white text-blue-400 text-[10px] rounded border border-[#1e2638] font-mono transition"
                    >
                      JSON Array (Batch)
                    </button>
                    <button
                      onClick={() => setIngestPayloadText("coffee: 100, tea: 10, cab_cost: 500")}
                      className="px-2 py-0.5 bg-[#141b29] hover:bg-blue-600 hover:text-white text-blue-400 text-[10px] rounded border border-[#1e2638] font-mono transition"
                    >
                      Key-Value
                    </button>
                  </div>
                </div>
                <textarea
                  value={ingestPayloadText}
                  onChange={(e) => setIngestPayloadText(e.target.value)}
                  rows={6}
                  className="w-full bg-[#090d16] border border-[#1e2638] rounded-lg p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500 resize-y"
                />
              </div>

              <button
                onClick={handlePush}
                disabled={isPushing}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-blue-500/20 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isPushing ? "Appending to WAL..." : "Push to SynapseDB (Single or Batch)"}</span>
              </button>

              {pushAck && (
                <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-400 text-[11px] uppercase tracking-wider">{pushAck.title}</span>
                    <span className="font-mono text-slate-400 text-[11px]\">RowID: {pushAck.rowId}</span>
                  </div>
                  <span className="text-slate-300 text-xs">{pushAck.detail}</span>
                </div>
              )}
            </div>

            <div className="bg-[#0f1422] border border-[#1e2638] rounded-xl p-5 flex flex-col gap-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white">Synthetic Stress Generator</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Programmatically streams 25–250 simulated transactions into the database
                  </p>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                  Benchmark Bot
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 block mb-1">Records Count</label>
                <select
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  className="w-full bg-[#090d16] border border-[#1e2638] rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500"
                >
                  <option value={25}>25 synthetic records</option>
                  <option value={50}>50 synthetic records</option>
                  <option value={100}>100 synthetic records</option>
                  <option value={250}>250 synthetic records</option>
                </select>
              </div>

              <button
                onClick={handleGenerateBatch}
                disabled={isGenerating}
                className="w-full py-2.5 bg-[#1e2638] hover:bg-[#2a354c] text-slate-100 rounded-lg text-xs font-semibold border border-slate-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>{isGenerating ? `Streaming ${genProgress}%...` : `Ingest ${batchSize} Synthetic Batch`}</span>
              </button>

              {isGenerating && (
                <div className="w-full bg-[#090d16] rounded-full h-2 overflow-hidden border border-[#1e2638]">
                  <div
                    className="bg-blue-500 h-full transition-all duration-100 ease-out"
                    style={{ width: `${genProgress}%` }}
                  />
                </div>
              )}

              {genStats && (
                <div className="p-4 rounded-lg bg-[#090d16] border border-[#1e2638] flex flex-col gap-2">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Batch Summary</h4>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 bg-[#121826] rounded border border-[#1e2638]">
                      <span className="text-slate-500 block text-[10px]">Ingested</span>
                      <span className="font-bold text-white font-mono">{genStats.total}</span>
                    </div>
                    <div className="p-2 bg-[#121826] rounded border border-[#1e2638]">
                      <span className="text-slate-500 block text-[10px]">Median Latency</span>
                      <span className="font-bold text-emerald-400 font-mono">{genStats.median}</span>
                    </div>
                    <div className="p-2 bg-[#121826] rounded border border-[#1e2638]">
                      <span className="text-slate-500 block text-[10px]">Status</span>
                      <span className="font-bold text-blue-400 text-[11px]">{genStats.status}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: SYNTAX & RULES CHEAT SHEET                         */}
        {/* ========================================================= */}
        {activeTab === "docs" && (
          <div className="bg-[#0f1422] border border-[#1e2638] rounded-xl p-6 shadow-xl flex flex-col gap-6 max-w-4xl mx-auto">
            <div>
              <h2 className="text-xl font-bold text-white">SynapseDB Syntax & Ingestion Rules</h2>
              <p className="text-xs text-slate-400 mt-1">
                Because SynapseDB runs on a lightweight, deterministic CPU-hosted SLM rather than an expensive cloud LLM, it follows clean syntactical structures.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-lg bg-[#090d16] border border-[#1e2638] flex flex-col gap-2">
                <h3 className="font-bold text-blue-400 text-sm">1. Key-Value Notation</h3>
                <p className="text-slate-400">Use colons <code>:</code> or equals <code>=</code>. No spaces inside keys:</p>
                <pre className="bg-[#121826] p-2.5 rounded font-mono text-slate-200 text-[11px]">
                  coffee: 100, tea: 10, cab_cost: 500
                </pre>
                <span className="text-emerald-400 text-[11px]">→ Creates typed Int64 columns automatically</span>
              </div>

              <div className="p-4 rounded-lg bg-[#090d16] border border-[#1e2638] flex flex-col gap-2">
                <h3 className="font-bold text-blue-400 text-sm">2. JSON Array (Batch)</h3>
                <p className="text-slate-400">Pasting an array creates independent rows for mathematical aggregations:</p>
                <pre className="bg-[#121826] p-2.5 rounded font-mono text-slate-200 text-[11px]">
{`[
  {"item": "coffee", "cost": 100},
  {"item": "tea", "cost": 10}
]`}
                </pre>
                <span className="text-emerald-400 text-[11px]">→ Enables SUM(cost) & AVG(cost)</span>
              </div>

              <div className="p-4 rounded-lg bg-[#090d16] border border-[#1e2638] flex flex-col gap-2">
                <h3 className="font-bold text-blue-400 text-sm">3. SQL Queries</h3>
                <p className="text-slate-400">Supports column projection, comparison filters, and zone map pruning:</p>
                <pre className="bg-[#121826] p-2.5 rounded font-mono text-slate-200 text-[11px]">
{`SELECT * FROM rides WHERE amount > 30
SELECT COUNT(*), AVG(amount) FROM rides
SELECT * FROM demo WHERE message LIKE 'coffee'`}
                </pre>
              </div>

              <div className="p-4 rounded-lg bg-[#090d16] border border-[#1e2638] flex flex-col gap-2">
                <h3 className="font-bold text-purple-400 text-sm">4. Natural Language (SLM)</h3>
                <p className="text-slate-400">Mention table name + keywords (total, average, count, max, min):</p>
                <pre className="bg-[#121826] p-2.5 rounded font-mono text-purple-200 text-[11px]">
{`Total rides where amount > 30
Average spent in rides
Count of orders where amount >= 100`}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
