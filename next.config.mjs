/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Keep the headless-Chrome PDF deps OUT of the webpack bundle. @sparticuz/chromium
    // ships a packed Brotli binary and puppeteer-core uses dynamic requires; bundling
    // them breaks the launch. Marking them external makes Next trace them as raw files.
    serverComponentsExternalPackages: ["@sparticuz/chromium", "puppeteer-core", "imapflow", "nodemailer", "mailparser"],
    // Boot-time schema-drift guard (KT #295). The hook runs once per server
    // process and probes the schema-manifest against the live DB.
    instrumentationHook: true,
  },
};
export default nextConfig;
