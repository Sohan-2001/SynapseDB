import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "SynapseDB — Sub-Millisecond Durable Writes & Zero-DDL Columnar Analytics";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0B0F19 0%, #111827 50%, #0B0F19 100%)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ambient glow */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "800px",
            height: "400px",
            background: "radial-gradient(ellipse, rgba(16, 185, 129, 0.15) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />

        {/* Top accent line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            background: "linear-gradient(90deg, transparent, #10B981, #34D399, #10B981, transparent)",
          }}
        />

        {/* Logo + Brand */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            marginBottom: "32px",
          }}
        >
          {/* Logo Brand Mark */}
          <svg width="80" height="80" viewBox="0 0 64 64" fill="none">
            <rect width="64" height="64" rx="16" fill="#0B0F19" stroke="rgba(16, 185, 129, 0.6)" strokeWidth="2" />
            <path d="M16 40 C16 35 48 35 48 40 L48 45 C48 50 16 50 16 45 Z" fill="#059669" opacity="0.85" />
            <ellipse cx="32" cy="40" rx="16" ry="5" fill="#0B132B" stroke="#059669" strokeWidth="1.5" />
            <path d="M16 29 C16 24 48 24 48 29 L48 34 C48 39 16 39 16 34 Z" fill="#10B981" opacity="0.9" />
            <ellipse cx="32" cy="29" rx="16" ry="5" fill="#0E1E2E" stroke="#10B981" strokeWidth="1.5" />
            <line x1="24" y1="28" x2="24" y2="35" stroke="#34D399" strokeWidth="1.2" strokeOpacity="0.6" />
            <line x1="40" y1="28" x2="40" y2="35" stroke="#34D399" strokeWidth="1.2" strokeOpacity="0.6" />
            <path d="M16 18 C16 13 48 13 48 18 L48 23 C48 28 16 28 16 23 Z" fill="#34D399" />
            <ellipse cx="32" cy="18" rx="16" ry="5" fill="#132E27" stroke="#34D399" strokeWidth="1.5" />
            <path d="M24 18 C34 21 28 27 38 29 C46 31 26 37 30 44" stroke="#6EE7B7" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="24" cy="18" r="2.5" fill="#ECFDF5" stroke="#10B981" strokeWidth="1.2" />
            <circle cx="38" cy="29" r="2.5" fill="#ECFDF5" stroke="#34D399" strokeWidth="1.2" />
            <circle cx="30" cy="44" r="2.5" fill="#ECFDF5" stroke="#059669" strokeWidth="1.2" />
            <circle cx="42" cy="17" r="1.5" fill="#6EE7B7" opacity="0.9" />
            <circle cx="20" cy="33" r="1.5" fill="#6EE7B7" opacity="0.8" />
          </svg>
          <span
            style={{
              fontSize: "64px",
              fontWeight: 900,
              color: "#F8FAFC",
              letterSpacing: "-2px",
            }}
          >
            SynapseDB
          </span>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: "28px",
            fontWeight: 700,
            color: "#34D399",
            textAlign: "center",
            marginBottom: "16px",
            letterSpacing: "-0.5px",
          }}
        >
          Sub-Millisecond Durable Writes · Zero-DDL Columnar Analytics
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: "20px",
            fontWeight: 400,
            color: "#94A3B8",
            textAlign: "center",
            maxWidth: "800px",
            lineHeight: 1.5,
          }}
        >
          Ingest single JSON rows at &lt;1ms with synchronous fsync WAL durability.
          Query with vectorized SIMD columnar analytics in microseconds. Built in Rust.
        </div>

        {/* Feature pills */}
        <div
          style={{
            display: "flex",
            gap: "16px",
            marginTop: "36px",
          }}
        >
          {["< 1ms fsync WAL", "Zero-DDL Schema", "SIMD Vectorized", "Open Source"].map(
            (label) => (
              <div
                key={label}
                style={{
                  padding: "10px 24px",
                  borderRadius: "9999px",
                  border: "1px solid rgba(16, 185, 129, 0.4)",
                  background: "rgba(16, 185, 129, 0.1)",
                  color: "#A7F3D0",
                  fontSize: "16px",
                  fontWeight: 600,
                }}
              >
                {label}
              </div>
            )
          )}
        </div>

        {/* Bottom URL */}
        <div
          style={{
            position: "absolute",
            bottom: "24px",
            fontSize: "16px",
            color: "#475569",
            fontWeight: 500,
          }}
        >
          synapsedb.vercel.app
        </div>
      </div>
    ),
    { ...size }
  );
}
