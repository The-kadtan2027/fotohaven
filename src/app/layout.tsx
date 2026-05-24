import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ToastProvider";

export const metadata: Metadata = {
  title: "FotoHaven | Professional Photo Handoff",
  description: "Secure, elegant photo delivery for photographers and clients.",
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
          <div style={{ flex: 1 }}>
            {children}
          </div>
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
