/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // The local network intercepts TLS with a root Node doesn't trust, so the
    // image optimizer can't fetch remote photos in dev. The browser trusts it
    // fine, so serve originals directly in dev and keep optimization in prod.
    unoptimized: process.env.NODE_ENV === 'development',
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'plus.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
      }
    ],
  },
};

export default nextConfig;
