/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
  // Next.js's serverless build only bundles files reachable from imports. The docs
  // markdown files are read at runtime via fs.readFile, so we have to explicitly
  // tell the bundler to include them in the lambda.
  outputFileTracingIncludes: {
    "/api/**/*": ["./.arkive/**/*"],
  },
};

export default nextConfig;
