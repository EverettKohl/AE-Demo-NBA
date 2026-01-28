import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Only allow http/https URLs
  if (!/^https?:\/\//i.test(targetUrl)) {
    return NextResponse.json({ error: "Invalid url parameter" }, { status: 400 });
  }

  try {
    const upstream = await fetch(targetUrl, {
      redirect: "follow",
      headers: {
        Accept: "image/*",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: "Upstream fetch failed" }, { status: upstream.status });
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Allow browser usage from localhost or deployed origins
        "Access-Control-Allow-Origin": "*",
        // Cache for a bit to reduce repeated fetches; tune as needed
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (err) {
    console.error("image-proxy fetch failed:", err);
    return NextResponse.json({ error: "Proxy fetch error" }, { status: 502 });
  }
}
