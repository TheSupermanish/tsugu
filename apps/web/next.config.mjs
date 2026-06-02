/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @asom/sdk ships ESM from dist; transpile it (and silence optional WC/pino externals).
  transpilePackages: ["@asom/sdk"],
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
