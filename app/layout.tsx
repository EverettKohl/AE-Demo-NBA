import type { Metadata } from "next";
import "./globals.css";

import { Toaster } from "./reactvideoeditor/pro/components/ui/toaster";
import { PostHogProvider } from "./reactvideoeditor/pro/components/providers/posthog-provider";

export const metadata: Metadata = {
  title: "Attention Engine Demo",
  description: "Attention Engine Demo",
  icons: {
    icon: "/AELogoicon.png",
    shortcut: "/AELogoicon.png",
    apple: "/AELogoicon.png",
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
        <link rel="icon" href="/AELogoicon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/AELogoicon.png" />
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
