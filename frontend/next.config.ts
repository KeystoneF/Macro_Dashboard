import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';

// Where Express actually is. Hardcoding localhost meant any deploy with the API
// on another host silently proxied into nothing.
//
// API_HOST is a bare hostname, so it gets a scheme. API_ORIGIN wins over it.
const API_ORIGIN =
  process.env.API_ORIGIN ??
  (process.env.API_HOST ? `https://${process.env.API_HOST}` : 'http://localhost:4000');

const isLoopback = (origin: string) => /\/\/(localhost|127\.0\.0\.1)\b/.test(origin);

// Nothing on these pages loads from another origin: no font CDN, no analytics,
// no image host, and the one external chart is proxied through /api. So the
// policy names 'self' and the two schemes lib/png.ts needs to hand a chart back
// as a file.
//
// Both 'unsafe-inline' entries are real limits and not oversights. Next inlines
// its own bootstrap and flight data, and the alternative is minting a nonce per
// request in middleware; every panel styles itself with a style attribute,
// which is what a policy without it blocks. Neither is a strict policy. Both
// still stop a script being loaded from anywhere but this origin.
const csp = (dev: boolean) =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // dev needs eval for react refresh and a websocket for hot reload
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    `connect-src 'self'${dev ? ' ws:' : ''}`,
  ].join('; ');

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

  const dev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    // names the framework to anyone scanning, and nothing reads it
    poweredByHeader: false,

    async headers() {
      return [
        {
          // /api is excluded: express sets its own headers on those responses
          // and the proxy passes them through, so matching here would send two
          // of each
          source: '/((?!api/).*)',
          headers: [
            { key: 'Content-Security-Policy', value: csp(dev) },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'Referrer-Policy', value: 'same-origin' },
            // a browser ignores this over plain http, which is what dev is
            ...(dev
              ? []
              : [
                  {
                    key: 'Strict-Transport-Security',
                    value: 'max-age=31536000; includeSubDomains',
                  },
                ]),
          ],
        },
      ];
    },

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
