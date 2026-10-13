import type { NextConfig } from "next";

const localBuild = process.env.ARCHEAGENT_LOCAL_BUILD ?? "";
if (localBuild !== "" && localBuild !== "completion") throw new Error("Invalid local build selection");
const nextConfig: NextConfig = {
  // Never rebuild the existing user's preview output during local acceptance.
  distDir: localBuild === "completion" ? ".next-local-completion" : ".next",
};

export default nextConfig;
