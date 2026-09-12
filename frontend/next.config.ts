import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';

function apiOrigin() {
  const value = process.env.API_ORIGIN ||
    (process.env.API_HOST ? `https://${process.env.API_HOST}` : 'http://localhost:4000');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API_ORIGIN must be an HTTP(S) origin without a path or credentials');
  }
  return url.origin;
}

// Next bootstrap scripts and existing style attributes require inline allowances.
const csp = (dev: boolean) => [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  `connect-src 'self'${dev ? ' ws:' : ''}`,
].join('; ');

export default function config(phase: string): NextConfig {
  const origin = apiOrigin();
  const host = new URL(origin).hostname;
  // Proxy destinations are baked into the production build.
  if (phase === PHASE_PRODUCTION_BUILD && process.env.RENDER && ['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    throw new Error('Set API_ORIGIN to the deployed API before building on Render');
  }
  const dev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    poweredByHeader: false,
    async headers() {
      return [{
        source: '/((?!api/).*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp(dev) },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          ...(dev ? [] : [{
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          }]),
        ],
      }];
    },
    async rewrites() {
      return [{ source: '/api/:path*', destination: `${origin}/api/:path*` }];
    },
  };
}
