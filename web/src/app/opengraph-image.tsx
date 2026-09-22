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
          {/* Icon circle */}
          <div
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              background: "#000000",
              border: "3px solid rgba(16, 185, 129, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 40px rgba(16, 185, 129, 0.3)",
            }}
          >
            <span style={{ fontSize: "40px", color: "#34D399" }}>⚡</span>
          </div>
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
