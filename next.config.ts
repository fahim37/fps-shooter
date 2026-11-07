import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/** The commit being built: open tabs compare it with /version to pick up a new deploy. */
function buildId() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
};

export default nextConfig;
