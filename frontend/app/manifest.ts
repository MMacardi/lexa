import type { MetadataRoute } from "next";

// Web App Manifest — makes Onomika installable ("Add to Home Screen") and gives it
// an app icon, name and standalone (no browser chrome) window.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Onomika — language learning",
    short_name: "Onomika",
    description: "Collect words, review with spaced repetition, read and learn — even offline.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f1ec",
    theme_color: "#f4f1ec",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
