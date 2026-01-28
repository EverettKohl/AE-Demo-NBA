import { NextResponse } from "next/server";

const ALLOWED_ORIGIN =
  process.env.NEXT_PUBLIC_APP_ORIGIN ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "*";

const allowCredentials = ALLOWED_ORIGIN !== "*";
const baseCorsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  ...(allowCredentials ? { "Access-Control-Allow-Credentials": "true" } : {}),
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Range,Origin,Accept",
  "Access-Control-Expose-Headers": "Content-Type,Content-Length,Content-Range,Accept-Ranges",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

const copyUpstreamHeaders = (response) => {
  const headers = new Headers(baseCorsHeaders);
  const passthrough = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
    "cache-control",
  ];
  passthrough.forEach((key) => {
    const value = response.headers.get(key);
    if (value) {
      headers.set(key.replace(/(^|-)([a-z])/g, (m) => m.toUpperCase()), value);
    }
  });
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=600");
  }
  return headers;
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: baseCorsHeaders });
}

export async function HEAD(req) {
  return handleProxy(req, true);
}

/**
 * Proxy endpoint to fetch video streams with proper CORS headers
 * This is needed because FFmpeg WebAssembly with COEP headers requires
 * resources to have proper CORS headers
 */
export async function GET(req) {
  return handleProxy(req, false);
}

async function handleProxy(req, headOnly) {
  const { searchParams } = new URL(req.url);
  const videoUrl = searchParams.get("url");

  if (!videoUrl) {
    return NextResponse.json(
      { error: "Missing required parameter: url" },
      { status: 400 }
    );
  }

  // Security: Validate URL to prevent SSRF attacks
  try {
    const url = new URL(videoUrl);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return NextResponse.json(
        { error: "Invalid URL protocol. Only http and https are allowed." },
        { status: 400 }
      );
    }
    // Block private/internal IP addresses (basic SSRF protection)
    const hostname = url.hostname;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('172.17.') ||
      hostname.startsWith('172.18.') ||
      hostname.startsWith('172.19.') ||
      hostname.startsWith('172.20.') ||
      hostname.startsWith('172.21.') ||
      hostname.startsWith('172.22.') ||
      hostname.startsWith('172.23.') ||
      hostname.startsWith('172.24.') ||
      hostname.startsWith('172.25.') ||
      hostname.startsWith('172.26.') ||
      hostname.startsWith('172.27.') ||
      hostname.startsWith('172.28.') ||
      hostname.startsWith('172.29.') ||
      hostname.startsWith('172.30.') ||
      hostname.startsWith('172.31.') ||
      hostname === '0.0.0.0'
    ) {
      return NextResponse.json(
        { error: "Access to internal resources is not allowed" },
        { status: 403 }
      );
    }
  } catch (urlError) {
    return NextResponse.json(
      { error: "Invalid URL format" },
      { status: 400 }
    );
  }

  try {
    const rangeHeader = req.headers.get("range");
    const response = await fetch(videoUrl, {
      headers: {
        Accept: "*/*",
        "User-Agent": "Mozilla/5.0",
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
    }

    const headers = copyUpstreamHeaders(response);
    const status = response.status;

    if (headOnly) {
      return new NextResponse(null, { status, headers });
    }

    return new NextResponse(response.body, {
      status,
      headers,
    });
  } catch (error) {
    console.error("Error proxying video:", error);
    return NextResponse.json(
      { error: error.message || "Failed to proxy video" },
      { status: 500, headers: baseCorsHeaders }
    );
  }
}

