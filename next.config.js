/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import './src/env.js';

/** @type {import("next").NextConfig} */
const config = {
  output: 'standalone',
  async redirects() {
    return [
      { source: '/tests', destination: '/soulscope/tests', permanent: true },
      {
        source: '/tests/:path*',
        destination: '/soulscope/tests/:path*',
        permanent: true,
      },
      {
        source: '/results',
        destination: '/soulscope/results',
        permanent: true,
      },
      {
        source: '/results/:path*',
        destination: '/soulscope/results/:path*',
        permanent: true,
      },
      {
        source: '/share/:path*',
        destination: '/soulscope/share/:path*',
        permanent: true,
      },
    ];
  },
};

export default config;
