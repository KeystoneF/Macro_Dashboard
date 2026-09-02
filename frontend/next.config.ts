import type { NextConfig } from 'next';

// Where Express actually is. Hardcoding localhost meant any deploy with the API
// on another host silently proxied into nothing.
//
// API_HOST is the bare hostname Render fills in from the api service, so it gets
// a scheme. API_ORIGIN set by hand wins over it.
const API_ORIGIN =
  process.env.API_ORIGIN ??
  (process.env.API_HOST ? `https://${process.env.API_HOST}` : 'http://localhost:4000');

// rewrites() is read once at build and the destination is baked into
// routes-manifest.json, so a wrong origin here cannot be corrected by restarting
// with a new environment. Fail the build rather than deploy a desk whose every
// panel proxies into nothing.
if (process.env.RENDER && /\/\/(localhost|127\.0\.0\.1)\b/.test(API_ORIGIN)) {
  throw new Error(
    'API_ORIGIN and API_HOST are both unset: every /api call would proxy to localhost',
  );
}

const nextConfig: NextConfig = {
  async rewrites() {
    // browser talks to :3000 only, express stays behind it and CORS stops mattering
    return [
      {
        source: '/api/:path*',
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
