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

function jsonErr(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

async function callStepService(layoutJson: any): Promise<string> {
  const raw = (process.env.STEP_SERVICE_URL || "").trim();
  if (!raw) throw new Error("STEP_SERVICE_URL is not set");

  const base = normalizeBaseUrl(raw);

  // IMPORTANT:
  // - If STEP_SERVICE_URL already includes a path, we should try it directly first.
  // - Then try common suffixes.
  const candidates = [base, base + "/api/step", base + "/step"];

  const payload = { layout: layoutJson };

  let lastErr: any = null;

  for (const url of candidates) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45_000);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));

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
        return stepText;
      } else {
        const stepText = await res.text();
        if (!stepText || stepText.trim().length === 0) {
          throw new Error("STEP service returned empty text.");
        }
        return stepText;
      }
    } catch (e: any) {
      lastErr = e;
      // try next candidate
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

    const stepText = await callStepService(pkg.layout_json);

    // Save back into SAME latest package row (Path A)
    await q(
      `
      UPDATE public.quote_layout_packages
      SET step_text = $1
      WHERE id = $2
    `,
      [stepText, pkg.id],
    );

    return NextResponse.json({ ok: true, pkg_id: pkg.id });
  } catch (err: any) {
    console.error("POST /api/quote/layout/rebuild-step error:", err);
    return jsonErr(500, "SERVER_ERROR", String(err?.message ?? err));
  }
}
