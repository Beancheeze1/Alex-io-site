import { NextResponse } from "next/server";

function getBaseUrl(req: Request) {
  const hdr = (n: string) => (req.headers.get(n) || "").toString();
  const proto = hdr("x-forwarded-proto") || "https";
  const host  = hdr("x-forwarded-host") || hdr("host") || process.env.APP_BASE_URL;
  if (host?.startsWith("http")) return host;
  return `${proto}://${host}`;
}

export async function GET(req: Request) {
  try {
    const base = getBaseUrl(req);
    const res = await fetch(`${base}/api/admin/whoami`, { cache: "no-store" });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      return NextResponse.json(json, { status: res.status });
    } catch {
      return NextResponse.json({ ok: false, note: "admin/whoami returned non-JSON", status: res.status, body: text }, { status: 200 });
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 200 });
  }
}
