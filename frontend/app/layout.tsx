import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/AppShell";
import { themeBootScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Lexa — learn English through the news",
  description:
    "Collect English words from real news, with Chinese translations, flashcards and recall checks.",
};

// Mobile-first viewport: cover the notch/safe-areas and match the browser chrome
// to the app surface in both themes.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ec" },
    { media: "(prefers-color-scheme: dark)", color: "#17130e" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme boot script sets html.class before hydration, so the server
    // markup intentionally differs from the client — silence that warning.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set the theme class before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* App Router root layout: these load globally for every page. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500&family=Hanken+Grotesk:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
