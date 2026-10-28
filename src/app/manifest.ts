import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Amogana — Auto-Trading Control Room",
    short_name: "Amogana",
    description: "Run, monitor and risk-manage your trading bots.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B120F",
    theme_color: "#0B120F",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
