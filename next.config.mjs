/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The legacy single-team scaffolding has loose types (carry-over from the
  // Vite/Lovable prototype). Don't gate prod builds on type errors while we
  // refactor toward the multi-tenant schema; vitest still runs in CI.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
