import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const objectId = body.objectId?.toString() || body.threadId?.toString();
    if (!objectId) {
      return NextResponse.json({ ok: false, error: "missing objectId or threadId" }, { status: 400 });
    }

    // Optional HubSpot token (skips if not provided)
    const hubspotToken = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!hubspotToken && process.env.HUBSPOT_SKIP_LOOKUP !== "1") {
      console.warn("[lookup] HUBSPOT_ACCESS_TOKEN missing");
      return NextResponse.json({ ok: false, error: "missing HubSpot token" });
    }

    const res = await fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}?includePropertyVersions=false`, {
      headers: hubspotToken
        ? { Authorization: `Bearer ${hubspotToken}`, "Content-Type": "application/json" }
        : { "Content-Type": "application/json" },
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status, error: "hubspot_thread_fetch_failed", body: data });
    }

    // deep scan helper
    const dig = (obj: any, path: string[]): any => {
      if (!obj || !path.length) return obj;
      const [head, ...rest] = path;
      if (Array.isArray(obj)) return obj.map((o) => dig(o, path)).flat().filter(Boolean);
      if (typeof obj !== "object") return [];
      if (rest.length === 0) return obj[head];
      return dig(obj[head], rest);
    };

    const sources = {
      email: [
        ["messages", "participants", "email"],
        ["participants", "email"],
      ],
      subject: [
        ["messages", "subject"],
        ["subject"],
      ],
      text: [
        ["messages", "text"],
        ["messages", "body"],
        ["body"],
      ],
    };

    const picked: Record<string, any> = {};
    for (const [key, paths] of Object.entries(sources)) {
      for (const p of paths) {
        const found = dig(data, p);
        if (found && found.length) {
          picked[key] = found.find((v: any) => typeof v === "string" && v.trim());
          break;
        }
      }
    }

    const result = {
      ok: true,
      email: picked.email || "",
      subject: picked.subject || "",
      text: picked.text || "",
      threadId: Number(objectId),
      src: sources,
    };

    console.log("[lookup] result", result);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[lookup] error", err);
    return NextResponse.json({ ok: false, error: err.message || String(err) }, { status: 500 });
  }
}
