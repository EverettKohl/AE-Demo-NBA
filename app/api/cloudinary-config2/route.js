import { NextResponse } from "next/server";

export async function GET() {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || null;
  return NextResponse.json({ cloudName });
}
