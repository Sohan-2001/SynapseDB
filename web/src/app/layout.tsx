import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#0b0f19",
};

export const metadata: Metadata = {
  title: "SynapseDB Playground | Sub-Millisecond Hybrid Database",
  description: "Interactive online web playground for SynapseDB: Zero-DDL dynamic schema inference, CPU-local SLM query planner, and vectorized columnar analytics.",
  keywords: ["SynapseDB", "Database", "Rust", "Columnar", "SLM", "OLAP", "OLTP", "Playground"],
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "SynapseDB Playground",
    description: "Experience sub-millisecond writes and microsecond columnar SQL queries in real-time.",
    url: "https://synapsedb.vercel.app",
    siteName: "SynapseDB",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth overflow-x-hidden">
      <body className="bg-white text-gray-900 min-h-screen antialiased selection:bg-blue-600 selection:text-white overflow-x-hidden safe-container">
        {children}
      </body>
    </html>
  );
}
