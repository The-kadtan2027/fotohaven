/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['lucide-react'],
  // Native module — must not be bundled by webpack
  serverExternalPackages: ['better-sqlite3'],
  // Allow builds to complete even if there are lint errors (for now)
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Allow server action payloads up to 25 MB (large photo metadata)
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
