import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#000000",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://synapsedb.vercel.app"),
  title: {
    default: "SynapseDB | Sub-Millisecond Durable Writes & Zero-DDL Columnar Analytics",
    template: "%s | SynapseDB",
  },
  description:
    "SynapseDB delivers sub-millisecond durable single-row writes (<1ms fsync WAL) + zero-DDL JSON ingestion + vectorized columnar analytics with deterministic CPU-local SLM query compilation. The high-rate transactional alternative to DuckDB.",
  keywords: [
    "SynapseDB",
    "DuckDB alternative",
    "Columnar Database",
    "Zero-DDL Database",
    "Write-Ahead Log fsync",
    "In-Memory Database",
    "Rust Database",
    "SLM Query Planner",
    "Real-Time Analytics",
    "OLTP OLAP Hybrid",
    "Vectorized Analytics",
  ],
  authors: [{ name: "Sohan Karfa", url: "https://github.com/Sohan-2001" }],
  creator: "Sohan Karfa",
  publisher: "SynapseDB Open Source Project",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "SynapseDB | Sub-Millisecond Durable Writes & Zero-DDL Columnar Analytics",
    description:
      "Sub-millisecond single-row durable writes (<1ms fsync WAL) meet instant columnar analytics. Zero DDL required. Built in Rust.",
    url: "https://synapsedb.vercel.app",
    siteName: "SynapseDB",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "SynapseDB — Sub-Millisecond Durable Writes & Zero-DDL Columnar Analytics",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SynapseDB | Sub-Millisecond Durable Writes & Zero-DDL Columnar Analytics",
    description:
      "Ingest single JSON rows at sub-millisecond speeds with synchronous fsync durability. Query with vectorized SIMD columnar analytics in microseconds.",
    creator: "@Sohan_2001",
    images: ["/twitter-image"],
  },
  alternates: {
    canonical: "https://synapsedb.vercel.app",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "SynapseDB",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Windows, Linux, macOS",
      offers: {
        "@type": "Offer",
        price: "0.00",
        priceCurrency: "USD",
      },
      description:
        "An open-source hybrid database engine in Rust providing sub-millisecond durable single-row writes, zero-DDL schema inference, and vectorized columnar analytics with deterministic CPU-local SLM query compilation.",
      softwareRequirements: "Rust 1.75+",
      url: "https://synapsedb.vercel.app",
      author: {
        "@type": "Person",
        name: "Sohan Karfa",
        url: "https://github.com/Sohan-2001",
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "How does SynapseDB compare to DuckDB?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "DuckDB is an analytical database optimized for bulk batch loads and parquet scans. However, DuckDB lacks high-throughput single-row durable writes. SynapseDB bridges this gap by delivering sub-millisecond synchronous fsync WAL appends for individual JSON records alongside in-memory vectorized columnar analytics.",
          },
        },
        {
          "@type": "Question",
          name: "What is Zero-DDL columnar analytics?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Zero-DDL allows applications to send raw JSON, JSON arrays, or key-value logs directly to SynapseDB without prior CREATE TABLE statements or migration scripts. In-memory micro-batch coordinators automatically infer types, widen numeric schemas, and encode vectors into Arrow-style column chunks.",
          },
        },
        {
          "@type": "Question",
          name: "How does SynapseDB ensure crash-resilient durability?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "SynapseDB commits every record with a 24-byte header containing CRC32 checksums and invokes physical hardware fsync write barriers before returning acknowledgments. During restart, automated torn-write truncation restores valid records without data loss.",
          },
        },
        {
          "@type": "Question",
          name: "Why use an embedded CPU Small Language Model (SLM) instead of cloud LLMs?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Cloud LLMs introduce 200–800ms of latency, recurring API costs, non-deterministic outputs, and data privacy leaks. SynapseDB's CPU-local SLM runs in-process in under 50 microseconds with zero cloud dependencies, zero cost, and 100% reproducible SQL AST generation.",
          },
        },
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth overflow-x-hidden">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="bg-white text-gray-900 min-h-screen antialiased selection:bg-emerald-600 selection:text-white overflow-x-hidden safe-container">
        {children}
      </body>
    </html>
  );
}
