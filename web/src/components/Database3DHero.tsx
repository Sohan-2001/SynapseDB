"use client";

import React, { useRef, useEffect, useState } from "react";
import { Zap, ShieldCheck, Database, Layers, Sparkles, Activity } from "lucide-react";

interface Database3DHeroProps {
  onExploreClick?: () => void;
}

export default function Database3DHero({ onExploreClick }: Database3DHeroProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeTier, setActiveTier] = useState<number | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [pulseCount, setPulseCount] = useState(0);

  // Mouse tilt offsets
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });

  const tiersInfo = [
    {
      id: 0,
      name: "Tier 1: In-Memory MemTable",
      badge: "Active Buffer",
      latency: "< 0.01 ms",
      desc: "Instant lock-free ingestion for raw JSON & CSV records",
      color: "#10b981",
      glow: "rgba(16, 185, 129, 0.45)",
    },
    {
      id: 1,
      name: "Tier 2: Vectorized Columnar Store",
      badge: "SIMD Analytics",
      latency: "0.04 ms",
      desc: "Zero-copy columnar compression with vectorized CPU aggregations",
      color: "#059669",
      glow: "rgba(5, 150, 105, 0.45)",
    },
    {
      id: 2,
      name: "Tier 3: Durable Append-Only WAL",
      badge: "ACID Durability",
      latency: "fsync 0.5 ms",
      desc: "Crash-resilient append log ensuring zero data loss",
      color: "#34d399",
      glow: "rgba(52, 211, 153, 0.45)",
    },
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let width = 0;
    let height = 0;
    let time = 0;

    // Pulse rings
    interface Shockwave {
      tierIndex: number;
      radius: number;
      maxRadius: number;
      opacity: number;
    }
    const shockwaves: Shockwave[] = [];

    // Particle nodes orbiting (Green & White only)
    const particleCount = 28;
    const particles = Array.from({ length: particleCount }, (_, i) => ({
      angle: (i / particleCount) * Math.PI * 2,
      speed: 0.008 + (i % 3) * 0.004,
      radiusOffset: 25 + (i % 4) * 20,
      yOffset: -60 + ((i * 15) % 130),
      size: 1.5 + (i % 3) * 1.2,
      pulsePhase: Math.random() * Math.PI * 2,
      color: i % 3 === 0 ? "#10b981" : i % 3 === 1 ? "#ffffff" : "#34d399",
    }));

    function handleResize() {
      if (!canvas || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = Math.min(Math.max(rect.width * 0.75, 340), 460);

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx?.scale(dpr, dpr);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    // Mouse movement inside container
    function handleMouseMove(e: MouseEvent) {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      mouseRef.current.targetX = nx * 0.35;
      mouseRef.current.targetY = ny * 0.25;
    }

    function handleMouseLeave() {
      mouseRef.current.targetX = 0;
      mouseRef.current.targetY = 0;
      setIsHovered(false);
    }

    function handleMouseEnter() {
      setIsHovered(true);
    }

    const containerEl = containerRef.current;
    if (containerEl) {
      containerEl.addEventListener("mousemove", handleMouseMove);
      containerEl.addEventListener("mouseleave", handleMouseLeave);
      containerEl.addEventListener("mouseenter", handleMouseEnter);
    }

    // Render loop
    function render() {
      if (!ctx) return;
      time += 0.018;

      // Smooth mouse interpolation
      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.08;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.08;

      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2 + 10;
      const isMobile = width < 500;
      const baseRadiusX = isMobile ? width * 0.32 : Math.min(width * 0.24, 155);
      const baseRadiusY = baseRadiusX * 0.42;
      const tierSpacing = isMobile ? 54 : 64;
      const diskHeight = isMobile ? 22 : 26;

      // Draw subtle background ambient radial aura (Green & Obsidian Black)
      const radialGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        10,
        centerX,
        centerY,
        baseRadiusX * 2.2
      );
      radialGrad.addColorStop(0, "rgba(16, 185, 129, 0.14)");
      radialGrad.addColorStop(0.5, "rgba(5, 150, 105, 0.06)");
      radialGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = radialGrad;
      ctx.fillRect(0, 0, width, height);

      // Render vertical holographic energy conduit behind cylinders (Green)
      const conduitGrad = ctx.createLinearGradient(0, centerY - 110, 0, centerY + 110);
      conduitGrad.addColorStop(0, "rgba(16, 185, 129, 0)");
      conduitGrad.addColorStop(0.3, "rgba(52, 211, 153, 0.45)");
      conduitGrad.addColorStop(0.7, "rgba(16, 185, 129, 0.45)");
      conduitGrad.addColorStop(1, "rgba(5, 150, 105, 0)");

      ctx.beginPath();
      ctx.strokeStyle = conduitGrad;
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -time * 20;
      ctx.moveTo(centerX, centerY - 120);
      ctx.lineTo(centerX, centerY + 120);
      ctx.stroke();
      ctx.setLineDash([]);

      // 3 Database Tiers: 0: MemTable (top), 1: Columnar (middle), 2: WAL (bottom)
      // Render back-to-front: Bottom (Tier 2) to Top (Tier 0) - Green, White, Black
      const tiers = [
        { index: 2, label: "WAL", color: "#047857", accent: "#10b981", yOffset: tierSpacing },
        { index: 1, label: "COLUMNAR", color: "#065f46", accent: "#34d399", yOffset: 0 },
        { index: 0, label: "MEMTABLE", color: "#059669", accent: "#6ee7b7", yOffset: -tierSpacing },
      ];

      tiers.forEach((tier) => {
        const tiltX = mouseRef.current.x * 25;
        const tiltY = mouseRef.current.y * 18;
        const bobbing = Math.sin(time * 1.5 + tier.index * 1.2) * 3.5;
        const y = centerY + tier.yOffset + bobbing + tiltY;
        const rx = baseRadiusX + (activeTier === tier.index ? 8 : 0);
        const ry = baseRadiusY + (activeTier === tier.index ? 4 : 0);

        // Cylinder Body (extrusion downward)
        const bodyGrad = ctx.createLinearGradient(centerX - rx, y, centerX + rx, y + diskHeight);
        bodyGrad.addColorStop(0, "rgba(15, 23, 42, 0.95)");
        bodyGrad.addColorStop(0.2, tier.color);
        bodyGrad.addColorStop(0.5, "rgba(30, 41, 59, 0.92)");
        bodyGrad.addColorStop(0.8, tier.accent);
        bodyGrad.addColorStop(1, "rgba(15, 23, 42, 0.98)");

        ctx.beginPath();
        ctx.ellipse(centerX + tiltX, y + diskHeight, rx, ry, 0, 0, Math.PI);
        ctx.lineTo(centerX + tiltX + rx, y);
        ctx.ellipse(centerX + tiltX, y, rx, ry, 0, 0, Math.PI, true);
        ctx.lineTo(centerX + tiltX - rx, y + diskHeight);
        ctx.closePath();
        ctx.fillStyle = bodyGrad;
        ctx.fill();

        // Outer glow & rim border
        ctx.strokeStyle = activeTier === tier.index ? tier.accent : "rgba(255, 255, 255, 0.35)";
        ctx.lineWidth = activeTier === tier.index ? 2 : 1;
        ctx.stroke();

        // Cylinder Top Face
        const topGrad = ctx.createRadialGradient(
          centerX + tiltX - rx * 0.2,
          y - ry * 0.2,
          5,
          centerX + tiltX,
          y,
          rx
        );
        topGrad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
        topGrad.addColorStop(0.35, tier.accent);
        topGrad.addColorStop(0.8, tier.color);
        topGrad.addColorStop(1, "rgba(15, 23, 42, 0.9)");

        ctx.beginPath();
        ctx.ellipse(centerX + tiltX, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = topGrad;
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Inner concentric data tracks
        ctx.beginPath();
        ctx.ellipse(centerX + tiltX, y, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = time * 12 * (tier.index % 2 === 0 ? 1 : -1);
        ctx.stroke();
        ctx.setLineDash([]);

        // Central glowing core node
        ctx.beginPath();
        ctx.ellipse(centerX + tiltX, y, rx * 0.32, ry * 0.32, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fill();
        ctx.strokeStyle = tier.accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Pulsing light center
        const corePulse = Math.abs(Math.sin(time * 2 + tier.index));
        ctx.beginPath();
        ctx.arc(centerX + tiltX, y, 3 + corePulse * 2, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = tier.accent;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Front glowing indicator LED on cylinder edge
        const ledAngle = Math.PI / 2 + Math.sin(time * 1.5 + tier.index) * 0.4;
        const ledX = centerX + tiltX + Math.cos(ledAngle) * rx;
        const ledY = y + diskHeight * 0.5 + Math.sin(ledAngle) * ry;

        ctx.beginPath();
        ctx.arc(ledX, ledY, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = tier.accent;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Render orbiting synaptic particles and data packets
      particles.forEach((p) => {
        p.angle += p.speed;
        const px = centerX + Math.cos(p.angle) * (baseRadiusX + p.radiusOffset) + mouseRef.current.x * 20;
        const py = centerY + Math.sin(p.angle) * (baseRadiusY + p.radiusOffset * 0.45) + p.yOffset + mouseRef.current.y * 15;
        const alpha = 0.4 + Math.sin(time * 3 + p.pulsePhase) * 0.3;

        // Node dot
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        // Occasional synaptic link line to center cylinder
        if (Math.sin(p.angle * 2) > 0.85) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(centerX + mouseRef.current.x * 20, centerY + p.yOffset);
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = 0.15;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      });

      // Render expanding shockwaves from pulses
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const sw = shockwaves[i];
        sw.radius += 2.5;
        sw.opacity -= 0.02;

        if (sw.opacity <= 0 || sw.radius >= sw.maxRadius) {
          shockwaves.splice(i, 1);
          continue;
        }

        const tierY = centerY + (sw.tierIndex === 0 ? -tierSpacing : sw.tierIndex === 1 ? 0 : tierSpacing);
        ctx.beginPath();
        ctx.ellipse(centerX, tierY, sw.radius, sw.radius * 0.42, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(52, 211, 153, ${sw.opacity})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      animationId = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
      if (containerEl) {
        containerEl.removeEventListener("mousemove", handleMouseMove);
        containerEl.removeEventListener("mouseleave", handleMouseLeave);
        containerEl.removeEventListener("mouseenter", handleMouseEnter);
      }
    };
  }, [activeTier]);

  function triggerPulse() {
    setPulseCount((c) => c + 1);
    // Switch or highlight active tier
    setActiveTier((prev) => (prev === null ? 0 : (prev + 1) % 3));
  }

  return (
    <div className="w-full flex flex-col items-center select-none" ref={containerRef}>
      {/* 3D Canvas Visualizer Container with Aurora Border */}
      <div className="relative w-full max-w-2xl mx-auto rounded-3xl p-[1.5px] aurora-card shadow-xl overflow-hidden group">
        
        {/* Top Control & Status Bar */}
        <div className="absolute top-3 inset-x-3 sm:inset-x-5 z-20 flex items-center justify-between pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <div className="px-3.5 py-1.5 rounded-full glass-pill text-[11px] font-mono font-semibold text-slate-900 flex items-center gap-1.5 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>3D Engine Live</span>
            </div>
            <button
              onClick={triggerPulse}
              className="btn-glass-secondary px-3 py-1.5 rounded-full text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 shadow-2xs"
              title="Send a test query pulse through the 3D database stack"
            >
              <Zap className="w-3 h-3 text-emerald-500 fill-emerald-500" />
              <span className="hidden sm:inline">Send Query Pulse</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <span className="text-[11px] font-mono text-slate-400">Interactive Tilt Physics</span>
          </div>
        </div>

        {/* 3D Canvas Element */}
        <div className="relative w-full bg-gradient-to-b from-black via-[#0B0F19] to-black rounded-[calc(1.75rem-1.5px)] cursor-grab active:cursor-grabbing overflow-hidden flex items-center justify-center min-h-[300px] sm:min-h-[360px]">
          <canvas ref={canvasRef} className="w-full h-full block" />

          {/* Floating Tier Badges on the sides for desktop */}
          <div className="absolute left-3 sm:left-5 top-14 bottom-14 flex flex-col justify-between pointer-events-none hidden md:flex">
            {tiersInfo.map((tier) => (
              <div
                key={tier.id}
                onMouseEnter={() => setActiveTier(tier.id)}
                onMouseLeave={() => setActiveTier(null)}
                className={`pointer-events-auto p-3 rounded-2xl border backdrop-blur-md transition-all duration-300 max-w-[210px] text-left cursor-pointer ${
                  activeTier === tier.id
                    ? "bg-black/90 border-emerald-400/90 shadow-lg shadow-emerald-500/25 scale-105"
                    : "bg-black/70 border-white/15 hover:bg-black/90"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                    {tier.badge}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-emerald-400">
                    {tier.latency}
                  </span>
                </div>
                <div className="text-xs font-bold text-white mt-0.5">{tier.name.split(":")[1]}</div>
              </div>
            ))}
          </div>

          {/* Bottom Floating Hint */}
          <div className="absolute bottom-3 inset-x-0 flex items-center justify-center pointer-events-none px-4">
            <div className="px-3.5 py-1.5 rounded-full bg-black/80 backdrop-blur-md border border-white/15 text-slate-300 text-[11px] flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-emerald-400" />
              <span>Hover or move cursor over the 3D stack to explore memory & disk tiers</span>
            </div>
          </div>
        </div>

      </div>

      {/* Mobile Tier Selector Pill List */}
      <div className="md:hidden grid grid-cols-3 gap-2 w-full max-w-md mt-3 px-2">
        {tiersInfo.map((tier) => (
          <button
            key={tier.id}
            onClick={() => setActiveTier(activeTier === tier.id ? null : tier.id)}
            className={`p-2.5 rounded-2xl text-center border transition ${
              activeTier === tier.id
                ? "bg-emerald-50 border-emerald-500 text-emerald-950 font-bold shadow-2xs"
                : "bg-white border-slate-200 text-slate-800 font-medium"
            }`}
          >
            <div className="text-[10px] font-mono text-emerald-700 font-semibold">{tier.latency}</div>
            <div className="text-[11px] truncate mt-0.5">{tier.badge}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
