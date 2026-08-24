import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  serverExternalPackages: ["knex", "better-sqlite3"],
  // Docker uses the minimal standalone server. Local production builds retain
  // the regular `next start` workflow unless explicitly requested.
  output: process.env.STANDALONE_OUTPUT ? "standalone" : undefined,
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
