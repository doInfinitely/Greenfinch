/** @type {import('next').NextConfig} */
const isProduction = process.env.REPLIT_DEPLOYMENT === '1';

const nextConfig = {
  serverExternalPackages: ['snowflake-sdk'],
  allowedDevOrigins: ['*.replit.dev', '*.spock.replit.dev', '127.0.0.1'],
  env: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: isProduction
      ? process.env.CLERK_PUBLISHABLE_KEY_PRODUCTION
      : process.env.CLERK_PUBLISHABLE_KEY_DEVELOPMENT,
    CLERK_SECRET_KEY: isProduction
      ? process.env.CLERK_SECRET_KEY
      : process.env.CLERK_SECRET_KEY_DEVELOPMENT,
  },
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
