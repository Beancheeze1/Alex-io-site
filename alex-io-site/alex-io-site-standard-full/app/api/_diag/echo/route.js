import { NextResponse } from "next/server";

export async function GET(req) {
  return NextResponse.json({
    ok: true,
    method: "GET",
    url: req.url,
  }, { status: 200 });
}

export async function POST(req) {
  const raw = await req.text();
  // Don’t log secrets, just first 300 chars
  console.log("ECHO POST body:", raw.slice(0, 300));
  return NextResponse.json({
    ok: true,
    method: "POST",
    url: req.url,
    bodyPreview: raw.slice(0, 120),
  }, { status: 200 });
}

