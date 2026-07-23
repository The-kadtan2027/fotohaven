import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ToastProvider";
import { PwaInstaller } from "@/components/PwaInstaller";

export const viewport: Viewport = {
  themeColor: "#1a1208",
};

export const metadata: Metadata = {
  title: "FotoHaven | Professional Photo Handoff",
  description: "Secure, elegant photo delivery for photographers and clients.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FotoHaven",
  },
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* PWA Meta Tags */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />

        {/* Google Fonts loaded at runtime (not build time) — required for Android/Termux builds */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Sans:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <ToastProvider>
          <PwaInstaller />
          <div style={{ flex: 1 }}>{children}</div>
          <footer
            style={{
              padding: "10px 16px 18px",
              textAlign: "center",
              fontSize: 12,
              color: "var(--taupe)",
              background: "transparent",
            }}
          >
            made by gaju ❤️
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
