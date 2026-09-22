"use client";

import React, { useState, useEffect } from "react";
import {
  Zap,
  ExternalLink,
  Menu,
  X,
  ArrowRight,
  ArrowLeft,
  LogOut,
} from "lucide-react";
import LandingPage from "@/components/LandingPage";
import AuthModal from "@/components/AuthModal";
import PlaygroundStudio from "@/components/PlaygroundStudio";
import { getCachedUser, verifySession, signOut, User } from "@/lib/auth";
import {
  getApiBaseUrl,
  pingHealth,
} from "@/lib/api";

export default function SynapsePlayground() {
  const [currentView, setCurrentView] = useState<"landing" | "studio">("landing");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"query" | "ingest" | "browser" | "schema" | "health" | "docs">("query");

  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<"signin" | "signup">("signup");
  const [authPrompt, setAuthPrompt] = useState("Create a free account or sign in to test the interactive playground.");
  const [pendingTab, setPendingTab] = useState<"query" | "ingest" | "browser" | "schema" | "health" | "docs" | null>(null);
  
  // Connection State
  const [apiUrl, setApiUrl] = useState("");
  const [connected, setConnected] = useState(false);
  const [pingLatency, setPingLatency] = useState<number | null>(null);

  const [toasts, setToasts] = useState<{ id: number; message: string; type: string }[]>([]);

  function showToast(message: string, type = "info") {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
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

  async function checkHealth(url = apiUrl) {
    const res = await pingHealth(url);
    setConnected(res.ok);
    setPingLatency(res.latencyMs);
  }

  function handleOpenStudio(tab: "query" | "ingest" | "browser" | "schema" | "health" | "docs" = "query") {
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

  if (currentView === "landing") {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex flex-col font-sans">
        {/* Landing Top Navbar (Fixed to top of screen) */}
        <header className="fixed top-0 inset-x-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl px-3 sm:px-6 safe-px py-2.5 sm:py-3 shadow-2xs">
          <div className="max-w-7xl w-full mx-auto flex items-center justify-between gap-2 sm:gap-4 min-w-0">
            
            {/* Logo */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="flex items-center gap-1.5 sm:gap-2 group shrink-0"
              >
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold shadow-xs group-hover:scale-105 transition shrink-0">
                  <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 fill-current" />
                </div>
                <span className="font-extrabold text-base sm:text-lg tracking-tight text-slate-950">SynapseDB</span>
              </button>

              {/* Status Indicator */}
              <div className="hidden sm:flex items-center gap-2 px-2.5 sm:px-3 py-1 rounded-full glass-pill text-xs shrink-0">
                <div className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                <span className="text-slate-700 font-medium text-[11px] sm:text-xs">{connected ? "Cloud Engine Online" : "Connecting..."}</span>
                {pingLatency !== null && <span className="text-slate-400 text-[10px] sm:text-[11px]">({pingLatency} ms)</span>}
              </div>
            </div>

            {/* Desktop Nav Links */}
            <nav className="hidden md:flex items-center gap-1 text-xs font-semibold text-slate-600">
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="px-3.5 py-1.5 rounded-full hover:text-slate-950 hover:bg-slate-100/80 transition"
              >
                Overview
              </button>
              <a
                href="#demo-sandbox"
                className="px-3.5 py-1.5 rounded-full hover:text-slate-950 hover:bg-slate-100/80 transition"
              >
                Live Demo
              </a>
              <button
                onClick={() => handleOpenStudio("query")}
                className="px-3.5 py-1.5 rounded-full hover:text-slate-950 hover:bg-slate-100/80 transition"
              >
                Playground Studio
              </button>
              <a
                href="https://github.com/Sohan-2001/SynapseDB"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-1.5 rounded-full hover:text-slate-950 hover:bg-slate-100/80 transition flex items-center gap-1"
              >
                <span>GitHub</span>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </a>
            </nav>

            {/* Desktop Auth Controls */}
            <div className="hidden md:flex items-center gap-2 shrink-0">
              {currentUser ? (
                <>
                  <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 font-semibold">
                    <div className="w-5 h-5 rounded-full bg-black text-emerald-400 border border-emerald-500/40 flex items-center justify-center text-[10px] font-bold uppercase">
                      {currentUser.name.charAt(0)}
                    </div>
                    <span className="max-w-[120px] truncate">{currentUser.name}</span>
                  </div>
                  <button
                    onClick={() => handleOpenStudio("query")}
                    className="min-h-[36px] px-4 py-1.5 rounded-full btn-glass-primary text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                  >
                    <span>Open Studio</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleSignOut}
                    title="Sign Out"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full btn-glass-secondary text-slate-700 transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setAuthPrompt("Sign in to your SynapseDB account to access your studio.");
                      setAuthModalTab("signin");
                      setAuthModalOpen(true);
                    }}
                    className="min-h-[36px] px-4 py-1.5 rounded-full btn-glass-secondary text-xs font-semibold transition"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => {
                      setAuthPrompt("Create your free account to access the interactive playground.");
                      setAuthModalTab("signup");
                      setAuthModalOpen(true);
                    }}
                    className="min-h-[36px] px-4 py-1.5 rounded-full btn-glass-primary text-xs font-semibold transition shadow-sm"
                  >
                    Create Account
                  </button>
                </>
              )}
            </div>

            {/* Mobile Right Controls (< md) */}
            <div className="flex md:hidden items-center gap-1.5 shrink-0">
              {currentUser ? (
                <button
                  onClick={() => handleOpenStudio("query")}
                  className="px-2.5 sm:px-3 py-1.5 rounded-full btn-glass-primary text-xs font-semibold flex items-center gap-1 shadow-xs"
                >
                  <span>Studio</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setAuthPrompt("Sign in to your SynapseDB account.");
                      setAuthModalTab("signin");
                      setAuthModalOpen(true);
                    }}
                    className="px-2.5 sm:px-3 py-1.5 rounded-full btn-glass-secondary text-xs font-semibold transition"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => handleOpenStudio("query")}
                    className="hidden xs:inline-flex px-2.5 sm:px-3 py-1.5 rounded-full btn-glass-primary text-xs font-semibold items-center gap-1 shadow-xs"
                  >
                    <span>Studio</span>
                  </button>
                </>
              )}

              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="w-8 h-8 sm:w-9 sm:h-9 min-h-0 min-w-0 flex items-center justify-center rounded-full btn-glass-secondary text-slate-700 transition"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Mobile Menu Drawer */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-2.5 pt-2.5 border-t border-slate-200/80 flex flex-col gap-1.5 sm:gap-2 animate-in slide-in-from-top-2 duration-150 max-h-[calc(100vh-4rem)] overflow-y-auto">
              {currentUser && (
                <div className="px-3 py-2 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-950 truncate mr-2">Signed in as {currentUser.name}</span>
                  <button
                    onClick={handleSignOut}
                    className="text-emerald-700 hover:text-emerald-900 font-bold underline shrink-0"
                  >
                    Sign Out
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="w-full text-left px-3 py-2 rounded-xl text-xs sm:text-sm font-medium hover:bg-slate-100/80 text-slate-800 transition"
              >
                Overview
              </button>
              <button
                onClick={() => handleOpenStudio("query")}
                className="w-full text-left px-3.5 py-2 rounded-full text-xs sm:text-sm font-semibold btn-glass-primary flex items-center justify-between shadow-xs"
              >
                <span>Launch Playground Studio</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleOpenStudio("ingest")}
                className="w-full text-left px-3 py-2 rounded-xl text-xs sm:text-sm font-medium hover:bg-slate-100/80 text-slate-800 transition"
              >
                Data Ingestion Lab
              </button>
              <button
                onClick={() => handleOpenStudio("browser")}
                className="w-full text-left px-3 py-2 rounded-xl text-xs sm:text-sm font-medium hover:bg-slate-100/80 text-slate-800 transition"
              >
                Data Browser & Catalog
              </button>
              <a
                href="https://github.com/Sohan-2001/SynapseDB"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-left px-3 py-2 rounded-xl text-xs sm:text-sm font-medium hover:bg-slate-100/80 text-slate-800 flex items-center justify-between transition"
              >
                <span>GitHub Repository</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
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
                    className="w-full py-2 rounded-full btn-glass-secondary text-xs sm:text-sm font-semibold text-center"
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
                    className="w-full py-2 rounded-full btn-glass-primary text-xs sm:text-sm font-semibold text-center shadow-xs"
                  >
                    Create Free Account
                  </button>
                </div>
              )}
            </div>
          )}
        </header>

        {/* Landing Page Content (with top padding for fixed navbar) */}
        <main className="pt-[52px] sm:pt-[64px] w-full flex-1 flex flex-col min-w-0">
          <LandingPage
            onLaunchStudio={handleOpenStudio}
            apiUrl={apiUrl}
            connected={connected}
            pingLatency={pingLatency}
          />
        </main>

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
                  : "bg-slate-900 border-slate-800 text-emerald-400"
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

  // =========================================================================
  // STUDIO VIEW (Clean Component delegating to PlaygroundStudio)
  // =========================================================================
  return (
    <>
      <PlaygroundStudio
        apiUrl={apiUrl}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        onReturnToOverview={() => {
          setCurrentView("landing");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        connected={connected}
        pingLatency={pingLatency}
        initialTab={activeTab}
        showToast={showToast}
      />

      {/* Auth Modal (if triggered while in studio) */}
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
            className={`toast-enter px-4 py-2.5 rounded-full shadow-lg border text-xs font-semibold flex items-center gap-2 max-w-sm pointer-events-auto ${
              t.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : t.type === "error"
                ? "bg-red-50 border-red-200 text-red-800"
                : "bg-black border-slate-800 text-emerald-400"
            }`}
          >
            <span>{t.type === "success" ? "✓" : t.type === "error" ? "✗" : "ℹ"}</span>
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}
