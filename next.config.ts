import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MuPDF (WebAssembly) renders PDF pages to pictures for the Israel intake; it loads from node_modules at runtime
  serverExternalPackages: ["mupdf"],
};

export default nextConfig;
