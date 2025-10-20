// app/api/hubspot/properties/route.ts
import { NextResponse } from "next/server";
import { getAnyToken, hsFetch } from "@/lib/hubspot";

export const runtime = "nodejs";

// GET /api/hubspot/properties?object=deals|contacts|companies
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const object = url.searchParams.get("object") || "deals";
    const bundle = await getAnyToken();
    if (!bundle) {
      return NextResponse.json(
        { ok: false, error: "No token stored. Please authorize." },
        { status: 401 }
      );
    }
    const res = await hsFetch(bundle, `/crm/v3/properties/${encodeURIComponent(object)}`);
    const json = await res.json();
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: json }, { status: res.status });
    }
    return NextResponse.json({ ok: true, object, properties: json?.results ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
