"use client";

import React, { useState, useEffect } from "react";
import { X, Lock, Mail, User as UserIcon, Eye, EyeOff, Zap, Sparkles, ArrowRight } from "lucide-react";
import { signUp, signIn, demoLogin, User } from "@/lib/auth";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiUrl: string;
  initialTab?: "signin" | "signup";
  onAuthSuccess: (user: User) => void;
  promptMessage?: string;
}

export default function AuthModal({
  isOpen,
  onClose,
  apiUrl,
  initialTab = "signup",
  onAuthSuccess,
  promptMessage = "Create a free account or sign in to test the interactive playground.",
}: AuthModalProps) {
  const [tab, setTab] = useState<"signin" | "signup">(initialTab);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTab(initialTab);
    setErrorMsg(null);
  }, [initialTab, isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      if (tab === "signup") {
        const res = await signUp(name, email, password, apiUrl);
        if (res.success && res.user) {
          onAuthSuccess(res.user);
          onClose();
        } else {
          setErrorMsg(res.error || "Failed to create account on backend.");
        }
      } else {
        const res = await signIn(email, password, apiUrl);
        if (res.success && res.user) {
          onAuthSuccess(res.user);
          onClose();
        } else {
          setErrorMsg(res.error || "Failed to sign in.");
        }
      }
    } catch {
      setErrorMsg("Could not connect to the cloud authentication service.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoAccess() {
    setLoading(true);
    try {
      const res = await demoLogin(apiUrl);
      if (res.user) {
        onAuthSuccess(res.user);
        onClose();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div 
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 bg-slate-50/80 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20">
              <Zap className="w-5 h-5 text-white fill-current" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-950">
                {tab === "signup" ? "Create Your Account" : "Welcome Back"}
              </h3>
              <p className="text-xs text-slate-500">
                SynapseDB Backend Cloud Authentication
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Prompt Banner */}
        {promptMessage && (
          <div className="px-5 py-2.5 bg-blue-50/80 border-b border-blue-100 flex items-center gap-2 text-xs text-blue-800">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>{promptMessage}</span>
          </div>
        )}

        <div className="p-5 sm:p-6">
          {/* Tab Switcher */}
          <div className="flex p-1 rounded-xl bg-slate-100 mb-5 text-xs font-semibold text-slate-600">
            <button
              type="button"
              onClick={() => {
                setTab("signup");
                setErrorMsg(null);
              }}
              className={`flex-1 py-2 rounded-lg transition min-h-[40px] ${
                tab === "signup"
                  ? "bg-white text-blue-700 shadow-xs font-bold"
                  : "hover:text-slate-900"
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("signin");
                setErrorMsg(null);
              }}
              className={`flex-1 py-2 rounded-lg transition min-h-[40px] ${
                tab === "signin"
                  ? "bg-white text-blue-700 shadow-xs font-bold"
                  : "hover:text-slate-900"
              }`}
            >
              Sign In
            </button>
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {tab === "signup" && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Your Full Name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Alex Chen"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition min-h-[44px]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition min-h-[44px]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tab === "signup" ? "At least 6 characters" : "••••••••"}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[46px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md shadow-blue-500/20 transition flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Connecting to Backend...</span>
                </>
              ) : (
                <>
                  <span>{tab === "signup" ? "Create Account on Backend" : "Sign In to Backend"}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Login Option */}
          <div className="mt-5 pt-4 border-t border-slate-200/80 text-center">
            <p className="text-xs text-slate-500 mb-2.5">
              Just testing? Create an instant guest session on the server:
            </p>
            <button
              type="button"
              disabled={loading}
              onClick={handleDemoAccess}
              className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs border border-slate-200 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 text-amber-500 fill-current" />
              <span>1-Click Instant Guest Session</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
