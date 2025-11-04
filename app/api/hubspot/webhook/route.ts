// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET — Always return JSON for probes so you never see HTML.
 * Useful for: curl.exe -i "$BASE/api/hubspot/webhook?t=$(Get-Random)"
 */
export async function GET() {
  return NextResponse.json({ ok: true, method: "GET" });
}

/**
 * POST — Minimal, safe wrapper so this file “just works” today.
 * - Reads JSON (array or object) without throwing on bad input
 * - Emits tiny diagnostics so you can verify it’s wired
 * - Returns 200 JSON (NEVER HTML)
 *
 * NOTE: This is intentionally lightweight so it doesn’t fight your current
 * AI/graph code. If you already have a richer POST handler elsewhere,
 * you can copy its body in here 1:1 — the GET above won’t interfere.
 */
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    // Try to parse JSON body (array or object). If it fails, treat as empty.
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }

    // Small, safe shape check (no dependency on HubSpot types here).
    const arr = Array.isArray(body) ? body : body ? [body] : [];
    const first = arr[0] ?? null;

    // Shallow hints for your Render logs (console shows up in Render “Logs”)
    console.log("[webhook] ARRIVE %o", {
      len: arr.length,
      type: typeof first,
      hasEmail:
        !!(first &&
          typeof first === "object" &&
          // common HubSpot path: body[0].message.from.email
          (first as any)?.message?.from?.email),
      hasText:
        !!(first &&
          typeof first === "object" &&
          ((first as any)?.message?.text || (first as any)?.text)),
    });

    // Return JSON that your PowerShell probes can parse cleanly
    return NextResponse.json({
      ok: true,
      handled: true,
      ms: Date.now() - started,
      // Just enough echo to help you debug without leaking anything sensitive:
      hint: {
        array: arr.length > 0,
        keys: first && typeof first === "object" ? Object.keys(first as any) : [],
      },
    });
  } catch (err: any) {
    console.log("[webhook] ERROR %s", err?.message ?? "unknown");
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
