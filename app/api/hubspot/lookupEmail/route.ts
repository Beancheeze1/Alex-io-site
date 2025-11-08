import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => ({}));
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/hubspot/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    return NextResponse.json(json, { status: res.status || 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "lookupEmail relay failed" },
      { status: 500 }
    );
  }
}
