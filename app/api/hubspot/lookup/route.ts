// app/api/hubspot/lookup/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function requireEnv(name: string, optional = false) {
  const v = process.env[name];
  if (!v && !optional) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const objectId = body.objectId?.toString() || body.threadId?.toString();
    if (!objectId) {
      return NextResponse.json({ ok: false, error: "missing objectId or threadId" }, { status: 400 });
    }

    const skipLookup = process.env.HUBSPOT_SKIP_LOOKUP === "1";
    const hubspotToken = process.env.HUBSPOT_ACCESS_TOKEN;

    if (!hubspotToken && !skipLookup) {
      console.warn("[lookup] HUBSPOT_ACCESS_TOKEN missing");
      return NextResponse.json({ ok: false, error: "missing HubSpot token" });
    }

    // Tokenless fallback for dev/testing
    if (skipLookup) {
      console.log("[lookup:fallback] tokenless mode");
      return NextResponse.json({
        ok: true,
        email: "25thhourdesign@gmail.com",
        subject: "test",
        text: "12 x 8 x 2 in, qty 50",
        threadId: Number(objectId),
        internetMessageId: undefined, // unknown in fallback
        src: "@(email=deep/chooser; subject=direct/deep; text=messages)",
        fallback: true,
      });
    }

    // Real HubSpot fetch
    const res = await fetch(
      `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}?includePropertyVersions=false`,
      {
        headers: {
          Authorization: `Bearer ${hubspotToken!}`,
          "Content-Type": "application/json",
        },
      }
    );
    const data = await res.json();

    if (!res.ok) {
      console.warn("[lookup] hubspot_thread_fetch_failed", res.status, data);
      return NextResponse.json({
        ok: false,
        status: res.status,
        error: "hubspot_thread_fetch_failed",
        body: data,
      });
    }

    // Deep getter
    const dig = (obj: any, path: string[]): any => {
      if (!obj || !path.length) return obj;
      const [head, ...rest] = path;
      if (Array.isArray(obj)) return obj.map((o) => dig(o, path)).flat().filter(Boolean);
      if (typeof obj !== "object") return [];
      if (rest.length === 0) return obj[head];
      return dig(obj[head], rest);
    };

    // Sources for email/subject/text
    const sources = {
      email: [["messages", "participants", "email"], ["participants", "email"]],
      subject: [["messages", "subject"], ["subject"]],
      text: [["messages", "text"], ["messages", "body"], ["body"]],
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

    // Try to locate an RFC 5322 internetMessageId
    // Common places (varies by source): messages[].internetMessageId, messages[].headers[].{name,value}
    let internetMessageId: string | undefined;
    const candidates =
      dig(data, ["messages"]) ||
      dig(data, ["items"]) ||
      [];

    if (Array.isArray(candidates)) {
      for (const m of candidates) {
        if (typeof m?.internetMessageId === "string") {
          internetMessageId = m.internetMessageId;
          break;
        }
        const headers = Array.isArray(m?.headers) ? m.headers : [];
        const h = headers.find(
          (x: any) =>
            (x?.name || "").toLowerCase() === "message-id" && typeof x?.value === "string" && x.value.includes("@")
        );
        if (h?.value) {
          internetMessageId = h.value;
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
      internetMessageId,
      src: sources,
    };

    console.log("[lookup] result", {
      email: !!result.email,
      subject: !!result.subject,
      text: !!result.text,
      hasInternetMessageId: !!internetMessageId,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[lookup] error", err);
    return NextResponse.json({ ok: false, error: err.message || String(err) }, { status: 500 });
  }
}
