import { NextResponse } from "next/server";
import { clearDedupeKey } from "@/lib/dedupe";

const SECRET = process.env.ADMIN_SECRET || ""; // optional

export async function POST(req) {
  try {
    const { key } = await req.json().catch(() => ({}));
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

    if (SECRET) {
      const url = new URL(req.url);
      if (url.searchParams.get("s") !== SECRET) {
        return NextResponse.json({ ok: true, note: "unauthorized" }, { status: 200 });
      }
    }

    await clearDedupeKey(key);
    return NextResponse.json({ ok: true, clearedKey: key }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

