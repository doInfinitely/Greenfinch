/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['snowflake-sdk'],
  allowedDevOrigins: ['*'],
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
