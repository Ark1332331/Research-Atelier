import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  /* config options here */
  // pdfjs-dist 在 Node 端（route handler）直接加载，避免 Next 打包后 worker 路径无法解析
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
