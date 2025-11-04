import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));

  try {
    const events = await req.json();
    console.log("[webhook] -> entry", { method: req.method, path: req.url, headers });

    const skipLookup = process.env.HUBSPOT_SKIP_LOOKUP === "1";
    if (skipLookup) console.log("[webhook] lookup skipped (tokenless mode)");

    for (const evt of events) {
      console.log("[webhook:event]", evt);
    }

    return NextResponse.json({ ok: true, skipLookup, ms: 200 });
  } catch (err: any) {
    console.error("[webhook] error", err);
    return NextResponse.json({ ok: false, error: err.message || String(err) }, { status: 500 });
  }
}
