import type { Metadata } from "next";
import "./globals.css";

import { Toaster } from "./reactvideoeditor/pro/components/ui/toaster";
import { PostHogProvider } from "./reactvideoeditor/pro/components/providers/posthog-provider";

const FAVICON = "/favicon.ico";

export const metadata: Metadata = {
  title: "Attention Engine Demo",
  description: "Attention Engine Demo",
  icons: {
    icon: [{ url: FAVICON, type: "image/x-icon" }],
    shortcut: [{ url: FAVICON, type: "image/x-icon" }],
    apple: [{ url: FAVICON, type: "image/x-icon" }],
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
        <link rel="icon" href={FAVICON} type="image/x-icon" />
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
