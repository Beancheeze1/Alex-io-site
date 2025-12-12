// app/api/quote/layout/rebuild-step/route.ts
//
// POST /api/quote/layout/rebuild-step
// Body: { "quote_no": "Q-..." }
//
// Behavior (Path A, minimal):
// - Loads latest quote_layout_packages row for the quote_no
// - Calls STEP microservice (STEP_SERVICE_URL)
// - Saves returned STEP back onto THAT SAME latest package row (step_text)
// - Returns ok:true
//
// Notes:
// - This does not create a new revision row (minimal + safest).
// - The download endpoint /api/quote/layout/step will then serve the refreshed STEP.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { one, q } from "@/lib/db";

type InBody = {
  quote_no?: string;
};

function jsonErr(status: number, error: string, message: string, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error, message, ...(extra || {}) }, { status });
}

// Helpful GET so curl.exe -i doesn't just 405 with no context
export async function GET() {
  return NextResponse.json({
    ok: false,
    error: "METHOD_NOT_ALLOWED",
    message: 'Use POST with JSON body: { "quote_no": "Q-..." }',
  });
}

async function callStepService(layoutJson: any): Promise<{ stepText: string; usedUrl: string }> {
  const base = (process.env.STEP_SERVICE_URL || "").trim();
  if (!base) throw new Error("STEP_SERVICE_URL is not set");

  const cleanBase = base.replace(/\/+$/, "");

  // Try the most likely endpoints without guessing too hard.
  const candidates = [`${cleanBase}/api/step`, `${cleanBase}/step`];

  const payload = { layout: layoutJson };

  let lastErr: any = null;

  for (const url of candidates) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 60_000); // 60s hard stop

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });

      const ct = res.headers.get("content-type") || "";

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`STEP service ${res.status} ${res.statusText}: ${text || "(no body)"}`);
      }

      // Handle either JSON or plain text response
      if (ct.includes("application/json")) {
        const json: any = await res.json();
        const stepText =
          (typeof json?.step_text === "string" && json.step_text) ||
          (typeof json?.step === "string" && json.step) ||
          (typeof json?.data === "string" && json.data) ||
          null;

        if (!stepText) {
          throw new Error("STEP service returned JSON but no step_text field was found.");
        }
        return { stepText, usedUrl: url };
      } else {
        const stepText = await res.text();
        if (!stepText || stepText.trim().length === 0) {
          throw new Error("STEP service returned empty text.");
        }
        return { stepText, usedUrl: url };
      }
    } catch (e: any) {
      lastErr = e;
      // try next candidate
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastErr || new Error("Failed to call STEP service.");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as InBody;
    const quote_no = String(body?.quote_no || "").trim();
    if (!quote_no) return jsonErr(400, "BAD_REQUEST", "Missing quote_no.");

    // Load latest layout package for this quote
    const pkg = await one<{
      id: number;
      quote_id: number;
      layout_json: any;
    }>(
      `
      SELECT lp.id, lp.quote_id, lp.layout_json
      FROM public.quote_layout_packages lp
      JOIN public.quotes q ON q.id = lp.quote_id
      WHERE q.quote_no = $1
      ORDER BY lp.created_at DESC, lp.id DESC
      LIMIT 1
    `,
      [quote_no],
    );

    if (!pkg) return jsonErr(404, "NOT_FOUND", "No layout package found for this quote.");

    const { stepText, usedUrl } = await callStepService(pkg.layout_json);

    // Save back into SAME latest package row (Path A)
    await q(
      `
      UPDATE public.quote_layout_packages
      SET step_text = $1
      WHERE id = $2
    `,
      [stepText, pkg.id],
    );

    return NextResponse.json({ ok: true, pkg_id: pkg.id, step_service_url: usedUrl });
  } catch (err: any) {
    console.error("POST /api/quote/layout/rebuild-step error:", err);
    const msg = String(err?.message ?? err);

    // Surface timeouts clearly
    if (msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("abort")) {
      return jsonErr(504, "STEP_TIMEOUT", "STEP service request timed out (60s).");
    }

    return jsonErr(500, "SERVER_ERROR", msg);
  }
}
