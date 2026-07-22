import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FotoHaven",
    short_name: "FotoHaven",
    description: "Secure, elegant photo delivery for photographers and clients.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#1a1208",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
