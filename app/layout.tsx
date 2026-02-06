import type { Metadata } from "next";
import "./globals.css";

import { Toaster } from "./reactvideoeditor/pro/components/ui/toaster";
import { PostHogProvider } from "./reactvideoeditor/pro/components/providers/posthog-provider";

const FAVICON = "/favicon.ico";
const SITE_NAME = "FanEdit.com";
const SITE_URL = "https://fanedit.com";
const SITE_DESCRIPTION = "FanEdit.com is the AI-powered fan edit creation platform that turns long-form footage into social-ready clips automatically.";
const SOCIAL_IMAGE = "/faneditMedia.png";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${SITE_NAME} — AI Fan Edit Creator`,
  description: SITE_DESCRIPTION,
  icons: {
    icon: [{ url: FAVICON, type: "image/x-icon" }],
    shortcut: [{ url: FAVICON, type: "image/x-icon" }],
    apple: [{ url: FAVICON, type: "image/x-icon" }],
  },
  openGraph: {
    title: `${SITE_NAME} — AI Fan Edit Creator`,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    images: [
      {
        url: SOCIAL_IMAGE,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} social preview`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — AI Fan Edit Creator`,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE],
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
