import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // pdfjs-dist 在 Node 端（route handler）直接加载，避免 Next 打包后 worker 路径无法解析
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
