import type { NextConfig } from 'next';

// Where Express actually is. Hardcoding localhost meant any deploy with the API
// on another host silently proxied into nothing.
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

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
