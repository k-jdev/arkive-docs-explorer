/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
  // Next.js's serverless build only bundles files reachable from imports. The skills
  // markdown files and the Postgres schema SQL are read at runtime via fs.readFile,
  // so we have to explicitly tell the bundler to include them in the lambda.
  outputFileTracingIncludes: {
    "/api/**/*": ["./skills/**/*", "./db/**/*"],
  },
};

export default nextConfig;
