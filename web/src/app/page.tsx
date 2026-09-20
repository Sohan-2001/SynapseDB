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
  Menu,
  X,
  ArrowLeft,
  ArrowRight,
  LayoutDashboard,
  LogOut,
  User as UserIcon,
} from "lucide-react";
import LandingPage from "@/components/LandingPage";
import AuthModal from "@/components/AuthModal";
import { getCachedUser, verifySession, signOut, User } from "@/lib/auth";
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
  const [currentView, setCurrentView] = useState<"landing" | "studio">("landing");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"query" | "browser" | "ingest" | "docs">("query");

  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<"signin" | "signup">("signup");
  const [authPrompt, setAuthPrompt] = useState("Create a free account or sign in to test the interactive playground.");
  const [pendingTab, setPendingTab] = useState<"query" | "browser" | "ingest" | "docs" | null>(null);
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

  const [toasts, setToasts] = useState<{id: number; message: string; type: string}[]>([]);
  
  function showToast(message: string, type = 'info') {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }

  useEffect(() => {
    const savedUrl = getApiBaseUrl();
    setApiUrl(savedUrl);
    const cached = getCachedUser();
    if (cached) setCurrentUser(cached);
    verifySession(savedUrl).then((verified) => {
      if (verified) setCurrentUser(verified);
      else if (cached) setCurrentUser(null);
    });
    checkHealth(savedUrl);
    const interval = setInterval(() => checkHealth(savedUrl), 8000);
    return () => clearInterval(interval);
  }, []);

  function handleOpenStudio(tab: "query" | "browser" | "ingest" | "docs" = "query") {
    if (!currentUser) {
      setPendingTab(tab);
      setAuthPrompt("Please create an account or sign in to test the interactive playground.");
      setAuthModalTab("signup");
      setAuthModalOpen(true);
      return;
    }
    setActiveTab(tab);
    setCurrentView("studio");
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleAuthSuccess(user: User) {
    setCurrentUser(user);
    showToast(`Welcome back, ${user.name}!`, "success");
    if (pendingTab) {
      setActiveTab(pendingTab);
      setCurrentView("studio");
      setPendingTab(null);
    } else {
      setCurrentView("studio");
    }
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSignOut() {
    signOut(apiUrl);
    setCurrentUser(null);
    setCurrentView("landing");
    setMobileMenuOpen(false);
    showToast("Signed out successfully", "info");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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
      showToast(`Push error: ${err.message}`, 'error');
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
      showToast(`Generator error: ${err.message}`, 'error');
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
      showToast("Sample data seeded successfully!", 'success');
      if (activeBrowserTable) loadBrowserTable(activeBrowserTable, apiUrl);
    } catch (err: any) {
      showToast(`Seeding failed: ${err.message}`, 'error');
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

  if (currentView === "landing") {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans">
        {/* Landing Top Navbar */}
        <header className="border-b border-slate-200/80 bg-white/85 backdrop-blur-xl px-4 sm:px-6 safe-px py-3 sticky top-0 z-40 shadow-2xs">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            
            {/* Logo */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="flex items-center gap-2 group"
              >
                <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20 group-hover:scale-105 transition">
                  <Zap className="w-4 h-4 text-white fill-current" />
                </div>
                <span className="font-extrabold text-lg tracking-tight text-slate-950">SynapseDB</span>
              </button>

              {/* Status Indicator */}
              <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full glass-pill text-xs">
                <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                <span className="text-slate-600 font-medium">{connected ? "Cloud Engine Online" : "Connecting..."}</span>
                {pingLatency !== null && <span className="text-slate-400 text-[11px]">({pingLatency} ms)</span>}
              </div>
            </div>

            {/* Desktop Nav Links */}
            <nav className="hidden md:flex items-center gap-1 text-xs font-semibold text-slate-600">
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="px-3 py-1.5 rounded-lg hover:text-slate-950 hover:bg-slate-100/80 transition"
              >
                Overview
              </button>
              <a
                href="#demo-sandbox"
                className="px-3 py-1.5 rounded-lg hover:text-slate-950 hover:bg-slate-100/80 transition"
              >
                Live Demo
              </a>
              <button
                onClick={() => handleOpenStudio("query")}
                className="px-3 py-1.5 rounded-lg hover:text-slate-950 hover:bg-slate-100/80 transition"
              >
                Playground Studio
              </button>
              <a
                href="https://github.com/Sohan-2001/SynapseDB"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg hover:text-slate-950 hover:bg-slate-100/80 transition flex items-center gap-1"
              >
                <span>GitHub</span>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </a>
            </nav>

            {/* Auth Controls */}
            <div className="flex items-center gap-2">
              {currentUser ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 font-semibold">
                    <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold uppercase">
                      {currentUser.name.charAt(0)}
                    </div>
                    <span className="hidden sm:inline max-w-[120px] truncate">{currentUser.name}</span>
                  </div>
                  <button
                    onClick={() => handleOpenStudio("query")}
                    className="min-h-[38px] px-4 py-1.5 rounded-xl btn-glass-primary text-xs font-semibold flex items-center gap-1.5"
                  >
                    <span>Open Studio</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleSignOut}
                    title="Sign Out"
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl btn-glass-secondary text-slate-600 transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setAuthPrompt("Sign in to your SynapseDB account to access your studio.");
                      setAuthModalTab("signin");
                      setAuthModalOpen(true);
                    }}
                    className="min-h-[38px] px-3.5 py-1.5 rounded-xl btn-glass-secondary text-xs font-semibold transition"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => {
                      setAuthPrompt("Create your free account to access the interactive playground.");
                      setAuthModalTab("signup");
                      setAuthModalOpen(true);
                    }}
                    className="min-h-[38px] px-4 py-1.5 rounded-xl btn-glass-primary text-xs font-semibold transition"
                  >
                    Create Account
                  </button>
                </div>
              )}

              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl btn-glass-secondary text-slate-700 transition"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
            </div>

          </div>

          {/* Mobile Drawer */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-3 pt-3 border-t border-slate-200 flex flex-col gap-2 pb-2">
              <div className="px-2 py-1.5 rounded-lg bg-slate-50 text-xs flex items-center justify-between text-slate-600">
                <span className="font-medium">Cloud Engine:</span>
                <span className="font-semibold text-emerald-600">{connected ? "Online" : "Connecting"}</span>
              </div>

              {currentUser && (
                <div className="px-3 py-2 rounded-lg bg-blue-50 text-xs text-blue-900 font-semibold flex items-center justify-between">
                  <span>Signed in as {currentUser.name}</span>
                  <button onClick={handleSignOut} className="text-red-600 hover:underline">
                    Sign Out
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-100/80 text-slate-800 transition"
              >
                Overview
              </button>
              <button
                onClick={() => handleOpenStudio("query")}
                className="w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-semibold btn-glass-primary flex items-center justify-between"
              >
                <span>Launch Playground Studio</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleOpenStudio("browser")}
                className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-100/80 text-slate-800 transition"
              >
                Data Browser
              </button>
              <button
                onClick={() => handleOpenStudio("ingest")}
                className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-100/80 text-slate-800 transition"
              >
                Ingestion Lab
              </button>
              <a
                href="https://github.com/Sohan-2001/SynapseDB"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-100/80 text-slate-800 flex items-center justify-between transition"
              >
                <span>GitHub Repository</span>
                <ExternalLink className="w-4 h-4 text-slate-400" />
              </a>

              {!currentUser && (
                <div className="pt-2 border-t border-slate-200/80 flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setAuthPrompt("Sign in to your SynapseDB account.");
                      setAuthModalTab("signin");
                      setAuthModalOpen(true);
                    }}
                    className="w-full py-2.5 rounded-xl btn-glass-secondary text-sm font-semibold text-center"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setAuthPrompt("Create your free account to access the interactive playground.");
                      setAuthModalTab("signup");
                      setAuthModalOpen(true);
                    }}
                    className="w-full py-2.5 rounded-xl btn-glass-primary text-sm font-semibold text-center"
                  >
                    Create Free Account
                  </button>
                </div>
              )}
            </div>
          )}
        </header>

        {/* Landing Page Content */}
        <LandingPage
          onLaunchStudio={handleOpenStudio}
          apiUrl={apiUrl}
          connected={connected}
          pingLatency={pingLatency}
        />

        {/* Auth Modal */}
        <AuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          apiUrl={apiUrl}
          initialTab={authModalTab}
          onAuthSuccess={handleAuthSuccess}
          promptMessage={authPrompt}
        />

        {/* Toast Notifications */}
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`toast-enter px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2 max-w-sm pointer-events-auto shadow-md ${
                t.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : t.type === "error"
                  ? "bg-red-50 border-red-200 text-red-800"
                  : "bg-blue-50 border-blue-200 text-blue-800"
              }`}
            >
              <span>{t.type === "success" ? "✓" : t.type === "error" ? "✗" : "ℹ"}</span>
              {t.message}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9] text-[#111827] flex flex-col font-sans">
      {/* Studio Header */}
      <header className="border-b border-[#E5E7EB] bg-white/90 backdrop-blur-xl px-4 sm:px-6 safe-px py-2.5 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 font-mono text-xs">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setCurrentView("landing");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="flex items-center gap-2 font-bold text-[#111827] hover:text-blue-600 transition"
            >
              <span className="text-blue-600">⚡</span>
              <span>SynapseDB</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                Studio Console
              </span>
            </button>
            <div
              onClick={() => setShowConfig(!showConfig)}
              className="flex items-center gap-2 px-2.5 py-1 rounded-full glass-pill text-[#6B7280] cursor-pointer hover:border-slate-400 transition"
            >
              <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              <span>{connected ? "online" : "connecting"}</span>
              {pingLatency !== null && <span className="text-slate-400">({pingLatency} ms)</span>}
              <Settings2 className="w-3.5 h-3.5 text-slate-400 hover:text-slate-700 ml-0.5" />
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {currentUser && (
              <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="max-w-[100px] truncate">{currentUser.name}</span>
              </div>
            )}
            <button
              onClick={seedSampleData}
              disabled={isSeeding}
              className="min-h-[36px] px-3.5 py-1.5 rounded-xl btn-glass-secondary text-slate-700 font-semibold text-xs transition"
            >
              {isSeeding ? "Seeding..." : "Seed Sample Data"}
            </button>
            <button
              onClick={() => {
                setCurrentView("landing");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="min-h-[36px] px-3.5 py-1.5 rounded-xl btn-glass-dark font-semibold text-xs transition flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Return to Overview</span>
            </button>
            {currentUser && (
              <button
                onClick={handleSignOut}
                title="Sign Out"
                className="min-h-[36px] px-2.5 py-1.5 rounded-xl btn-glass-secondary text-slate-600 transition text-xs font-semibold flex items-center gap-1"
              >
                <LogOut className="w-3 h-3" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Endpoint Config Dropdown Modal */}
      {showConfig && (
        <div className="bg-white border-b border-[#E5E7EB] px-6 py-3 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <span className="text-gray-500 whitespace-nowrap">Cloud Backend URL:</span>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              className="flex-1 bg-white border border-[#D1D5DB] rounded px-2.5 py-1 text-gray-800 font-mono text-xs focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => {
                setCustomApiUrl(apiUrl);
                checkHealth(apiUrl);
                setShowConfig(false);
              }}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
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
              className="text-gray-500 hover:text-gray-800 underline"
            >
              Reset
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col max-w-7xl w-full mx-auto p-4 md:p-6 safe-px gap-6 safe-container overflow-x-hidden">
        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200 gap-1 overflow-x-auto pb-0.5">
          <button
            onClick={() => setActiveTab("query")}
            className={`whitespace-nowrap shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
              activeTab === "query"
                ? "border-blue-500 text-blue-600 bg-blue-50/80 rounded-t-lg"
                : "border-transparent text-gray-500 hover:text-gray-800"
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
            className={`whitespace-nowrap shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
              activeTab === "browser"
                ? "border-blue-500 text-blue-600 bg-blue-50/80 rounded-t-lg"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <TableIcon className="w-4 h-4" />
            <span>Data Browser</span>
          </button>
          <button
            onClick={() => setActiveTab("ingest")}
            className={`whitespace-nowrap shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
              activeTab === "ingest"
                ? "border-blue-500 text-blue-600 bg-blue-50/80 rounded-t-lg"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <Download className="w-4 h-4" />
            <span>Ingestion Lab</span>
          </button>
          <button
            onClick={() => setActiveTab("docs")}
            className={`whitespace-nowrap shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition ${
              activeTab === "docs"
                ? "border-blue-500 text-blue-600 bg-blue-50/80 rounded-t-lg"
                : "border-transparent text-gray-500 hover:text-gray-800"
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
                <h2 className="text-xl font-bold tracking-tight text-gray-900">Query Studio</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Execute vectorized SQL or Natural Language queries compiled by our CPU-hosted SLM
                </p>
              </div>

              {/* Mode Toggle */}
              <div className="flex bg-gray-50 p-1 rounded-lg border border-gray-200">
                <button
                  onClick={() => {
                    setQueryMode("SQL");
                    setQueryText("SELECT COUNT(*), AVG(amount) FROM rides");
                  }}
                  className={`min-h-[44px] px-3 py-1 rounded text-xs font-semibold transition ${
                    queryMode === "SQL" ? "bg-blue-600 text-white shadow" : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  Direct SQL
                </button>
                <button
                  onClick={() => {
                    setQueryMode("NL");
                    setQueryText("Total rides where amount > 30");
                  }}
                  className={`min-h-[44px] px-3 py-1 rounded text-xs font-semibold flex items-center gap-1 transition ${
                    queryMode === "NL" ? "bg-purple-600 text-white shadow" : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  <Sparkles className="w-3 h-3 text-purple-500" />
                  <span>Natural Language (SLM)</span>
                </button>
              </div>
            </div>

            {/* Example Query Chips */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="text-gray-400 self-center text-[11px] font-medium mr-1">Quick Queries:</span>
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
                  className="min-h-[44px] px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-blue-400 hover:text-blue-600 transition font-mono text-[11px] shadow-2xs"
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Code Editor Box with Aurora Border */}
            <div className="aurora-card overflow-hidden shadow-lg flex flex-col">
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
                className="min-h-[44px] w-full bg-white text-gray-900 font-mono text-sm p-4 focus:outline-none resize-none border-b border-gray-200 rounded-t-2xl"
              />

              <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between rounded-b-2xl">
                <span className="text-gray-400 text-xs flex items-center gap-1.5">
                  Press <kbd className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 text-[10px] font-mono">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 text-[10px] font-mono">Enter</kbd> to execute
                </span>

                <button
                  onClick={handleRunQuery}
                  disabled={isQueryRunning}
                  className="min-h-[44px] flex items-center gap-2 px-5 py-1.5 rounded-xl btn-glass-primary text-xs font-semibold disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isQueryRunning ? "Running..." : "Run Query"}</span>
                </button>
              </div>
            </div>

            {/* Error Display */}
            {queryError && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <strong className="font-semibold block mb-0.5">Execution Error:</strong>
                  <span>{queryError}</span>
                </div>
              </div>
            )}

            {/* Query Results & Metrics Card with Aurora Border */}
            {queryResult && (
              <div className="aurora-card overflow-hidden shadow-lg flex flex-col gap-3 p-4 sm:p-5">
                {/* Stats Bar */}
                <div className="flex flex-wrap items-center justify-between pb-3 border-b border-gray-200 gap-4">
                  <div className="flex items-center gap-6 text-xs">
                    <div>
                      <span className="text-gray-400 block text-[10px] uppercase font-semibold">Status</span>
                      <span className="text-emerald-600 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> 200 OK
                      </span>
                    </div>
                    {queryResult.stats && (
                      <>
                        <div>
                          <span className="text-gray-400 block text-[10px] uppercase font-semibold">Engine Latency</span>
                          <span className="text-blue-600 font-mono font-bold">
                            {queryResult.stats.execution_time_us} μs
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-400 block text-[10px] uppercase font-semibold">Chunks Scanned</span>
                          <span className="text-gray-700 font-mono font-bold">
                            {queryResult.stats.chunks_scanned} chunk ({queryResult.stats.chunks_pruned} pruned)
                          </span>
                        </div>
                      </>
                    )}
                    <div>
                      <span className="text-gray-400 block text-[10px] uppercase font-semibold">Rows Matched</span>
                      <span className="text-gray-800 font-mono font-bold">{queryResult.row_count ?? (queryResult.rows?.length || 0)}</span>
                    </div>
                  </div>

                  {/* Toggle View Mode */}
                  <div className="flex bg-white p-0.5 rounded border border-gray-200 text-xs">
                    <button
                      onClick={() => setResultViewMode("table")}
                      className={`min-h-[44px] px-2.5 py-1 rounded text-xs font-medium transition ${
                        resultViewMode === "table" ? "bg-gray-200 text-blue-600" : "text-gray-500"
                      }`}
                    >
                      Table View
                    </button>
                    <button
                      onClick={() => setResultViewMode("json")}
                      className={`min-h-[44px] px-2.5 py-1 rounded text-xs font-medium transition ${
                        resultViewMode === "json" ? "bg-gray-200 text-blue-600" : "text-gray-500"
                      }`}
                    >
                      Raw JSON
                    </button>
                  </div>
                </div>

                {/* Table View */}
                {resultViewMode === "table" && queryResult.rows && queryResult.rows.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-100 text-gray-700 font-mono text-[11px] border-b border-gray-200">
                          {(queryResult.columns || Object.keys(queryResult.rows[0])).map((col) => (
                            <th key={col} className="p-2.5 font-semibold">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 font-mono">
                        {queryResult.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-blue-50 transition">
                            {(queryResult.columns || Object.keys(queryResult.rows![0])).map((col) => {
                              const val = row[col];
                              return (
                                <td key={col} className="p-2.5 text-gray-700">
                                  {val === null ? (
                                    <span className="text-gray-300 italic">null</span>
                                  ) : typeof val === "number" ? (
                                    <span className="text-emerald-600">{val}</span>
                                  ) : typeof val === "boolean" ? (
                                    <span className="text-amber-600">{String(val)}</span>
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
                    <pre className="bg-gray-50 p-3.5 rounded-lg font-mono text-xs text-blue-500 max-h-96 overflow-y-auto border border-gray-200">
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
              <h2 className="text-xl font-bold tracking-tight text-gray-900">Data Browser</h2>
              <p className="text-xs text-gray-500 mt-0.5">Live inspection of all tables, dynamic columns, and persisted rows</p>
            </div>

            {/* Table Selection Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-gray-400 text-xs font-medium">Tables:</span>
              {tablesList.length === 0 ? (
                <span className="text-gray-400 text-xs italic">No tables created yet. Click Seed Sample Data!</span>
              ) : (
                tablesList.map((t) => (
                  <button
                    key={t}
                    onClick={() => loadBrowserTable(t)}
                    className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
                      activeBrowserTable === t
                        ? "btn-glass-primary"
                        : "btn-glass-secondary"
                    }`}
                  >
                    <TableIcon className="w-3.5 h-3.5" />
                    <span>{t}</span>
                  </button>
                ))
              )}
            </div>

            {/* Action Bar (Search & Export) */}
            <div className="aurora-card-subtle p-3 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={browserSearch}
                  onChange={(e) => setBrowserSearch(e.target.value)}
                  placeholder={`Search rows in ${activeBrowserTable || "table"}...`}
                  className="min-h-[38px] w-full bg-white border border-gray-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-gray-800 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={exportCSV}
                  className="min-h-[38px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl btn-glass-secondary text-xs font-medium transition"
                >
                  <Download className="w-3.5 h-3.5 text-blue-600" />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={exportJSON}
                  className="min-h-[38px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl btn-glass-secondary text-xs font-medium transition"
                >
                  <Copy className="w-3.5 h-3.5 text-purple-600" />
                  <span>Export JSON</span>
                </button>
                <button
                  onClick={() => activeBrowserTable && loadBrowserTable(activeBrowserTable)}
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl btn-glass-secondary text-gray-600 hover:text-gray-900 transition"
                  title="Refresh table data"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Table Display with Aurora Card */}
            <div className="aurora-card overflow-hidden shadow-lg">
              {isBrowserLoading ? (
                <div className="p-10 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                  <span>Scanning columnar storage...</span>
                </div>
              ) : filteredBrowserRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-100 text-gray-700 font-mono text-[11px] border-b border-gray-200">
                        {(browserData?.columns || Object.keys(filteredBrowserRows[0])).map((col) => (
                          <th key={col} className="p-3 font-semibold">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-mono">
                      {filteredBrowserRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-blue-50 transition">
                          {(browserData?.columns || Object.keys(filteredBrowserRows[0])).map((col) => {
                            const val = row[col];
                            return (
                              <td key={col} className="p-3 text-gray-700">
                                {val === null ? (
                                  <span className="text-gray-300 italic">null</span>
                                ) : typeof val === "number" ? (
                                  <span className="text-emerald-600">{val}</span>
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
                <div className="p-10 text-center text-xs text-gray-400">
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
            <div className="aurora-card p-5 sm:p-6 flex flex-col gap-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Custom Data Ingestion</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Push single JSON, multi-record batches, or key-value strings into the WAL
                  </p>
                </div>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold shadow-2xs">
                  Zero-DDL
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Target Table</label>
                <input
                  type="text"
                  value={ingestTable}
                  onChange={(e) => setIngestTable(e.target.value)}
                  className="min-h-[44px] w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2 text-xs text-gray-800 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between mb-1.5 gap-2">
                  <label className="text-xs font-semibold text-gray-700">Payload</label>
                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      onClick={() =>
                        setIngestPayloadText(
                          JSON.stringify({ fare: +(20 + Math.random() * 80).toFixed(2), driver: "Alice", user_id: 1001 }, null, 2)
                        )
                      }
                      className="min-h-[32px] px-2.5 py-1 btn-glass-secondary text-blue-700 text-[11px] rounded-lg font-mono transition"
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
                      className="min-h-[32px] px-2.5 py-1 btn-glass-secondary text-blue-700 text-[11px] rounded-lg font-mono transition"
                    >
                      JSON Array (Batch)
                    </button>
                    <button
                      onClick={() => setIngestPayloadText("coffee: 100, tea: 10, cab_cost: 500")}
                      className="min-h-[32px] px-2.5 py-1 btn-glass-secondary text-blue-700 text-[11px] rounded-lg font-mono transition"
                    >
                      Key-Value
                    </button>
                  </div>
                </div>
                <textarea
                  value={ingestPayloadText}
                  onChange={(e) => setIngestPayloadText(e.target.value)}
                  rows={6}
                  className={`min-h-[44px] w-full bg-white border rounded-xl p-3.5 text-xs text-gray-800 font-mono focus:outline-none resize-y ${
                    new TextEncoder().encode(ingestPayloadText).length > 100 * 1024
                      ? "border-red-300 focus:border-red-500"
                      : "border-gray-200 focus:border-blue-500"
                  }`}
                />
                <div className="flex items-center justify-between mt-1 px-1">
                  <span
                    className={`text-[11px] font-mono ${
                      new TextEncoder().encode(ingestPayloadText).length > 100 * 1024
                        ? "text-red-600 font-bold flex items-center gap-1"
                        : "text-gray-400"
                    }`}
                  >
                    {new TextEncoder().encode(ingestPayloadText).length > 100 * 1024 && (
                      <AlertCircle className="w-3.5 h-3.5" />
                    )}
                    Payload Size: {(new TextEncoder().encode(ingestPayloadText).length / 1024).toFixed(1)} KB / 100 KB limit
                  </span>
                  <span className="text-[10px] text-gray-400">Rate Limited: 60 req/min</span>
                </div>
              </div>

              <button
                onClick={handlePush}
                disabled={isPushing || new TextEncoder().encode(ingestPayloadText).length > 100 * 1024}
                className={`min-h-[44px] w-full py-2.5 rounded-xl text-xs font-semibold shadow-lg transition flex items-center justify-center gap-2 ${
                  new TextEncoder().encode(ingestPayloadText).length > 100 * 1024
                    ? "bg-red-100 text-red-600 border border-red-200 cursor-not-allowed"
                    : "btn-glass-primary disabled:opacity-50"
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {new TextEncoder().encode(ingestPayloadText).length > 100 * 1024
                    ? "Cannot Push: Exceeds 100 KB Limit"
                    : isPushing
                    ? "Appending to WAL..."
                    : "Push to SynapseDB (Single or Batch)"}
                </span>
              </button>

              {pushAck && (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-700 text-[11px] uppercase tracking-wider">{pushAck.title}</span>
                    <span className="font-mono text-gray-500 text-[11px]">RowID: {pushAck.rowId}</span>
                  </div>
                  <span className="text-gray-700 text-xs">{pushAck.detail}</span>
                </div>
              )}
            </div>

            <div className="aurora-card p-5 sm:p-6 flex flex-col gap-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Synthetic Stress Generator</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Programmatically streams 25–250 simulated transactions into the database
                  </p>
                </div>
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold shadow-2xs">
                  Benchmark Bot
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Records Count</label>
                <select
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                  className="min-h-[44px] w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2 text-xs text-gray-800 font-mono focus:outline-none focus:border-blue-500"
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
                className="min-h-[44px] w-full py-2.5 btn-glass-secondary text-gray-900 rounded-xl text-xs font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Zap className="w-3.5 h-3.5 text-amber-600 fill-current" />
                <span>{isGenerating ? `Streaming ${genProgress}%...` : `Ingest ${batchSize} Synthetic Batch`}</span>
              </button>

              {isGenerating && (
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden border border-gray-200">
                  <div
                    className="bg-blue-600 h-full transition-all duration-100 ease-out"
                    style={{ width: `${genProgress}%` }}
                  />
                </div>
              )}

              {genStats && (
                <div className="p-4 rounded-xl bg-slate-50 border border-gray-200 flex flex-col gap-2">
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Batch Summary</h4>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2.5 bg-white rounded-lg border border-gray-200 shadow-2xs">
                      <span className="text-gray-400 block text-[10px]">Ingested</span>
                      <span className="font-bold text-gray-900 font-mono">{genStats.total}</span>
                    </div>
                    <div className="p-2.5 bg-white rounded-lg border border-gray-200 shadow-2xs">
                      <span className="text-gray-400 block text-[10px]">Median Latency</span>
                      <span className="font-bold text-emerald-600 font-mono">{genStats.median}</span>
                    </div>
                    <div className="p-2.5 bg-white rounded-lg border border-gray-200 shadow-2xs">
                      <span className="text-gray-400 block text-[10px]">Status</span>
                      <span className="font-bold text-blue-600 text-[11px]">{genStats.status}</span>
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
          <div className="aurora-card p-6 sm:p-8 shadow-xl flex flex-col gap-6 max-w-4xl mx-auto">
            <div>
              <h2 className="text-xl font-bold text-gray-900">SynapseDB Syntax & Ingestion Rules</h2>
              <p className="text-xs text-gray-500 mt-1">
                Because SynapseDB runs on a lightweight, deterministic CPU-hosted SLM rather than an expensive cloud LLM, it follows clean syntactical structures.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="aurora-card-subtle p-5 flex flex-col gap-2 shadow-2xs">
                <h3 className="font-bold text-blue-600 text-sm">1. Key-Value Notation</h3>
                <p className="text-gray-600">Use colons <code>:</code> or equals <code>=</code>. No spaces inside keys:</p>
                <pre className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg font-mono text-gray-800 text-[11px]">
                  coffee: 100, tea: 10, cab_cost: 500
                </pre>
                <span className="text-emerald-600 text-[11px] font-semibold">→ Creates typed Int64 columns automatically</span>
              </div>

              <div className="aurora-card-subtle p-5 flex flex-col gap-2 shadow-2xs">
                <h3 className="font-bold text-blue-600 text-sm">2. JSON Array (Batch)</h3>
                <p className="text-gray-600">Pasting an array creates independent rows for mathematical aggregations:</p>
                <pre className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg font-mono text-gray-800 text-[11px]">
{`[
  {"item": "coffee", "cost": 100},
  {"item": "tea", "cost": 10}
]`}
                </pre>
                <span className="text-emerald-600 text-[11px] font-semibold">→ Enables SUM(cost) & AVG(cost)</span>
              </div>

              <div className="aurora-card-subtle p-5 flex flex-col gap-2 shadow-2xs">
                <h3 className="font-bold text-blue-600 text-sm">3. SQL Queries</h3>
                <p className="text-gray-600">Supports column projection, comparison filters, and zone map pruning:</p>
                <pre className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg font-mono text-gray-800 text-[11px]">
{`SELECT * FROM rides WHERE amount > 30
SELECT COUNT(*), AVG(amount) FROM rides
SELECT * FROM demo WHERE message LIKE 'coffee'`}
                </pre>
              </div>

              <div className="aurora-card-subtle p-5 flex flex-col gap-2 shadow-2xs">
                <h3 className="font-bold text-purple-600 text-sm">4. Natural Language (SLM)</h3>
                <p className="text-gray-600">Mention table name + keywords (total, average, count, max, min):</p>
                <pre className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg font-mono text-purple-600 text-[11px]">
{`Total rides where amount > 30
Average spent in rides
Count of orders where amount >= 100`}
                </pre>
              </div>
            </div>
          </div>
        )}

        </div>

      {/* Toast Notifications */}
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => (
            <div key={t.id} className={`toast-enter px-4 py-3 rounded-xl shadow-lg border text-sm font-medium flex items-center gap-2 max-w-sm pointer-events-auto ${
              t.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
              t.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
              'bg-blue-50 border-blue-200 text-blue-700'
            }`}>
              <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : 'ℹ'}</span>
              {t.message}
            </div>
          ))}
        </div>
      </div>
  );
}
