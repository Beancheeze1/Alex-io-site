// app/api/quote/check/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED", message: "Login required." }, { status: 401 });
    }

    const t = req.nextUrl.searchParams.get("t") || "";
    if (!t) return NextResponse.json({ ok: false, error: "missing token" }, { status: 400 });
    const kv = makeKv();
    const v = await kv.get(`alexio:quote:${t}`);
    if (!v) return NextResponse.json({ ok: false, found: false }, { status: 404 });

    const data = JSON.parse(v);
    const quoteNo = typeof data?.quote_no === "string" ? data.quote_no.trim() : "";
    if (!quoteNo) {
      return NextResponse.json({ ok: true, found: false });
    }

    const quote = await one<{ id: number }>(
      `
      select id
      from quotes
      where quote_no = $1
        and tenant_id = $2
      `,
      [quoteNo, user.tenant_id],
    );
    if (!quote) return NextResponse.json({ ok: false, found: false }, { status: 404 });

    return NextResponse.json({ ok: true, found: true, data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown" }, { status: 500 });
  }
}
