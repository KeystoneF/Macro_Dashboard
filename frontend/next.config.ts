import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

// Where Express actually is. Hardcoding localhost meant any deploy with the API
// on another host silently proxied into nothing.
//
// API_HOST is a bare hostname, so it gets a scheme. API_ORIGIN wins over it.
const API_ORIGIN =
  process.env.API_ORIGIN ??
  (process.env.API_HOST ? `https://${process.env.API_HOST}` : 'http://localhost:4000');

const isLoopback = (origin: string) => /\/\/(localhost|127\.0\.0\.1)\b/.test(origin);

export default function config(phase: string): NextConfig {
  // rewrites() is read once at build and the destination is baked into
  // routes-manifest.json, so a wrong origin cannot be corrected by restarting
  // with a new environment. Checked here rather than at module scope because by
  // start time the value is already baked and a throw would only kill a service
  // that is serving correctly.
  if (phase === PHASE_PRODUCTION_BUILD && process.env.RENDER && isLoopback(API_ORIGIN)) {
    throw new Error(
      'API_ORIGIN and API_HOST are both unset: every /api call would proxy to localhost',
    );
  }

  return {
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
}
