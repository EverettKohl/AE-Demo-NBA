import type { Metadata } from "next";
import "./globals.css";

import { Toaster } from "./reactvideoeditor/pro/components/ui/toaster";
import { PostHogProvider } from "./reactvideoeditor/pro/components/providers/posthog-provider";

const FAVICON = "/AELogoicon.png";

export const metadata: Metadata = {
  title: "Attention Engine Demo",
  description: "Attention Engine Demo",
  icons: {
    icon: [{ url: FAVICON, type: "image/png", sizes: "any" }],
    shortcut: [{ url: FAVICON, type: "image/png" }],
    apple: [{ url: FAVICON, type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href={FAVICON} type="image/png" />
        <link rel="apple-touch-icon" href={FAVICON} />
      </head>
      <body suppressHydrationWarning>
        <PostHogProvider>
            <main>
              {children}
              <Toaster />
            </main>
        </PostHogProvider>
      </body>
    </html>
  );
}
