import type { NextConfig } from "next";

// Same-origin API proxy. The browser only ever calls /api/* on THIS origin; Next
// forwards it to the Express backend (Railway). Keeping the API same-origin makes
// the session and beta cookies first-party, so Safari (ITP) and other browsers
// don't drop them the way they drop cross-site cookies from a split
// Vercel-frontend ↔ Railway-backend deployment.
//
// BACKEND_URL is server-side only (NOT NEXT_PUBLIC_), so the backend host stays out
// of the client bundle. next.config is evaluated at build time, so on Vercel set
// BACKEND_URL before building; changing it later needs a redeploy.
//
// Local dev is unaffected: docker-compose / .env.local set NEXT_PUBLIC_API_URL, so
// the browser calls the backend directly (see lib/api.ts) and this rewrite is never
// exercised. If NEXT_PUBLIC_API_URL is unset, /api proxies to BACKEND_URL (default
// localhost:3000) — which also works for a bare `npm run dev`.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";

const nextConfig: NextConfig = {
  // The draw pad's stroke data is versioned by filename (hanzi-v1.bin), so it can
  // be cached for good instead of revalidated on every open.
  async headers() {
    return [
      {
        source: "/handwriting/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
