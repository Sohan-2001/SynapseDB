import React from "react";

interface SynapseLogoProps {
  className?: string;
  size?: number;
}

export default function SynapseLogo({ className = "w-8 h-8", size }: SynapseLogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      aria-label="SynapseDB Logo"
    >
      <defs>
        <linearGradient id="syn-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0B0F19" />
          <stop offset="100%" stopColor="#051B14" />
        </linearGradient>
        <linearGradient id="syn-emerald-top" x1="7" y1="7" x2="25" y2="13" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="syn-emerald-mid" x1="7" y1="13" x2="25" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
        <linearGradient id="syn-emerald-bot" x1="7" y1="19" x2="25" y2="25" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="100%" stopColor="#064E3B" />
        </linearGradient>
        <linearGradient id="syn-border" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" stopOpacity="0.7" />
          <stop offset="50%" stopColor="#34D399" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#059669" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="syn-glow-line" x1="10" y1="8" x2="22" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A7F3D0" />
          <stop offset="50%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#6EE7B7" />
        </linearGradient>
        <filter id="syn-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Rounded Squircle Badge with Emerald Rim */}
      <rect width="32" height="32" rx="8" fill="url(#syn-bg)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" stroke="url(#syn-border)" strokeWidth="1" />

      {/* Database Tiers - Columnar Storage Discs */}
      {/* Tier 3 (Bottom Disk: WAL) */}
      <path d="M8 20 C8 17.5 24 17.5 24 20 L24 22.5 C24 25 8 25 8 22.5 Z" fill="url(#syn-emerald-bot)" opacity="0.85" />
      <ellipse cx="16" cy="20" rx="8" ry="2.5" fill="#0B132B" stroke="#059669" strokeWidth="0.75" />

      {/* Tier 2 (Middle Disk: Columnar SIMD) */}
      <path d="M8 14.5 C8 12 24 12 24 14.5 L24 17 C24 19.5 8 19.5 8 17 Z" fill="url(#syn-emerald-mid)" opacity="0.9" />
      <ellipse cx="16" cy="14.5" rx="8" ry="2.5" fill="#0E1E2E" stroke="#10B981" strokeWidth="0.75" />
      {/* Columnar vector partitions */}
      <line x1="12" y1="14" x2="12" y2="17" stroke="#34D399" strokeWidth="0.6" strokeOpacity="0.6" />
      <line x1="20" y1="14" x2="20" y2="17" stroke="#34D399" strokeWidth="0.6" strokeOpacity="0.6" />

      {/* Tier 1 (Top Disk: Active MemTable) */}
      <path d="M8 9 C8 6.5 24 6.5 24 9 L24 11.5 C24 14 8 14 8 11.5 Z" fill="url(#syn-emerald-top)" />
      <ellipse cx="16" cy="9" rx="8" ry="2.5" fill="#132E27" stroke="#34D399" strokeWidth="0.8" />

      {/* Synaptic Pathway Connecting Database Tiers */}
      <path
        d="M12 9 C17 10.5 14 13.5 19 14.5 C23 15.5 13 18.5 15 22"
        stroke="url(#syn-glow-line)"
        strokeWidth="1.2"
        strokeLinecap="round"
        filter="url(#syn-glow)"
      />

      {/* Synaptic Neural Nodes */}
      <circle cx="12" cy="9" r="1.3" fill="#ECFDF5" stroke="#10B981" strokeWidth="0.6" />
      <circle cx="19" cy="14.5" r="1.3" fill="#ECFDF5" stroke="#34D399" strokeWidth="0.6" />
      <circle cx="15" cy="22" r="1.3" fill="#ECFDF5" stroke="#059669" strokeWidth="0.6" />

      {/* Satellite pulse nodes */}
      <circle cx="21" cy="8.5" r="0.7" fill="#6EE7B7" opacity="0.9" />
      <circle cx="10" cy="16.5" r="0.7" fill="#6EE7B7" opacity="0.8" />
    </svg>
  );
}
