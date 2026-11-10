import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  images: {
    // Media art and news imagery come from the API as absolute remote URLs.
    // Without these patterns `next/image` rejects every one of them with
    // 400 "url parameter is not allowed" and the whole card renders empty.
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "http", hostname: "localhost", port: "4000", pathname: "/**" },
      { protocol: "https", hostname: "**.unsplash.com" },
    ],
    // The server-side optimizer cannot reach the image CDN from this host
    // ("upstream image response failed"), so remote art is served straight
    // from the origin instead of being proxied and resized.
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
