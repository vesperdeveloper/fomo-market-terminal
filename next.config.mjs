/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'prod-fomo-profile-pics.s3.amazonaws.com' },
      { protocol: 'https', hostname: 'pbs.twimg.com' },
    ],
  },
};
export default nextConfig;
