/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Keep the headless-Chrome PDF deps OUT of the webpack bundle. @sparticuz/chromium
    // ships a packed Brotli binary and puppeteer-core uses dynamic requires; bundling
    // them breaks the launch. Marking them external makes Next trace them as raw files.
    serverComponentsExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "imapflow", "nodemailer", "mailparser"],
  },
};
export default nextConfig;
