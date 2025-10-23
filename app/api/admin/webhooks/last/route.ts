import { NextResponse } from "next/server";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOG_DIR = process.env.WEBHOOK_LOG_DIR || ".data/webhooks";

export async function GET(req: Request) {
  const adminKey = process.env.ADMIN_KEY || "";
  const hdr = new Headers(req.headers).get("x-admin-key") || "";
  if (!adminKey || hdr !== adminKey) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    // find latest *.json under LOG_DIR / subfolders
    const files: { path: string; mtime: number }[] = [];
    const walk = (dir: string) => {
      let entries: string[] = [];
      try { entries = readdirSync(dir); } catch { return; }
      for (const name of entries) {
        const p = join(dir, name);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p);
        else if (name.endsWith(".json")) files.push({ path: p, mtime: st.mtimeMs });
      }
    };
    walk(join(process.cwd(), LOG_DIR));
    if (files.length === 0) {
      return NextResponse.json({ ok: true, message: "No webhook logs found." });
    }
    files.sort((a, b) => b.mtime - a.mtime);
    const latest = files[0].path;

    // read + parse
    const raw = readFileSync(latest, "utf8");
    let doc: any = {};
    try { doc = JSON.parse(raw); } catch { /* keep doc as {} */ }

    // body might be a string or already-parsed array
    let events: any[] = [];
    const maybe = doc?.json ?? doc?.body ?? null;
    if (Array.isArray(maybe)) {
      events = maybe;
    } else if (typeof maybe === "string" && maybe.trim().startsWith("[")) {
      try { events = JSON.parse(maybe); } catch {/* leave empty */}
    }

    // extract likely IDs
    const uniq = <T>(arr: T[]) => Array.from(new Set(arr.filter(Boolean)));
    const threadIds = uniq(events.map((e: any) => e?.threadId ?? e?.thread_id ?? e?.thread?.id));
    const conversationIds = uniq(events.map((e: any) =>
      e?.conversationId ?? e?.objectId ?? e?.conversation?.id
    ));

    return NextResponse.json({
      ok: true,
      latestFile: latest.replace(process.cwd(), ""),
      count: events.length,
      threadIds,
      conversationIds,
      sample: events[0] ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
