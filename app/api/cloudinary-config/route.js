import { NextResponse } from "next/server";

/**
 * Returns Cloudinary configuration (cloud name)
 * This allows client components to access the cloud name without exposing it in the bundle
 */
export async function GET() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  
  if (!cloudName) {
    return NextResponse.json(
      { error: "Cloudinary cloud name not configured" },
      { status: 500 }
    );
  }

  return NextResponse.json({ cloudName });
}

