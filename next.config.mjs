/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['snowflake-sdk'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
