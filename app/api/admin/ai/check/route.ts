// app/api/admin/ai/check/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function GET() {
  try {
    const apiKey = requireEnv("OPENAI_API_KEY");

    // Minimal “ping” to confirm your key works from the server.
    // Using chat.completions for maximum compatibility.
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Respond with: pong" }],
        max_tokens: 5,
        temperature: 0,
      }),
    });

    const text = await r.text();
    let ok = r.ok;
    let reply = "";
    try {
      const j = JSON.parse(text);
      reply = j?.choices?.[0]?.message?.content ?? "";
      if (!reply) ok = false;
    } catch {
      ok = false;
    }

    return NextResponse.json(
      {
        ok,
        status: r.status,
        reply: reply || "(no reply parsed)",
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "ai_check_error" },
      { status: 200 }
    );
  }
}
