// app/api/hubspot/diag/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getAccessToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const direct = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (direct) return { ok: true, token: direct };

  const rt = process.env.HUBSPOT_REFRESH_TOKEN?.trim();
  const cid = process.env.HUBSPOT_CLIENT_ID?.trim();
  const sec = process.env.HUBSPOT_CLIENT_SECRET?.trim();
  if (!rt || !cid || !sec) return { ok: false, error: "missing_refresh_flow_envs" };

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("client_id", cid);
  form.set("client_secret", sec);
  form.set("refresh_token", rt);

  const r = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `refresh_failed_${r.status}` };
  const j = JSON.parse(text);
  const token = String(j.access_token || "");
  if (!token) return { ok: false, error: "no_access_token" };
  return { ok: true, token };
}

export async function GET() {
  try {
    const tok = await getAccessToken();
    if (!tok.ok) return NextResponse.json({ ok: false, step: "token", error: tok.error });

    // Introspect token: returns JSON with hub_id and scopes
    const ti = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${tok.token}`);
    const introspect = await ti.json().catch(() => ({} as any));

    const hubId = introspect.hub_id ?? introspect.hubId ?? null;
    const scopes: string[] = Array.isArray(introspect.scopes) ? introspect.scopes : [];

    // Quick list probe (first few threads)
    const list = await fetch("https://api.hubapi.com/conversations/v3/conversations/threads?limit=3", {
      headers: { Authorization: `Bearer ${tok.token}` },
    });
    const listText = await list.text();

    // Try to parse list body to pull any thread IDs
    let threadIds: number[] = [];
    try {
      const j = JSON.parse(listText);
      const items = j?.results || j?.threads || j || [];
      if (Array.isArray(items)) {
        threadIds = items
          .map((t: any) => Number(t?.id ?? t?.threadId ?? t?.objectId))
          .filter((n: any) => Number.isFinite(n));
      }
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      hubId,
      scopes,
      listStatus: list.status,
      threadIds,
      rawListSample: listText.slice(0, 600),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "diag_exception" });
  }
}
