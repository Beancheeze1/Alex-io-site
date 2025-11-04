// app/api/hubspot/lookup/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const objectId = Number(payload.objectId ?? payload.threadId);
  if (!objectId) {
    return NextResponse.json({ ok: false, error: "missing objectId or threadId" }, { status: 400 });
  }

  const token = requireEnv("HUBSPOT_ACCESS_TOKEN");
  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`;

  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await r.text();
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, status: r.status, error: "hubspot_look_up_failed", body: text.slice(0, 500) },
      { status: 200 }
    );
  }

  return NextResponse.json({ ok: true, status: r.status, thread: JSON.parse(text) }, { status: 200 });
}
