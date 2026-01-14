/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['snowflake-sdk'],
  allowedDevOrigins: ['*.replit.dev', '*.spock.replit.dev', '127.0.0.1'],
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
