// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { extractSlots, SlotMap } from "@/app/lib/parse/matchers";
import { makeKv } from "@/app/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrchestrateInput = {
  mode?: "ai";
  toEmail?: string;
  subject?: string;
  text?: string;
  inReplyTo?: string;
  dryRun?: boolean;
  ai?: { task?: string; hints?: string[] };
  hubspot?: { objectId?: string | number };
};

const s = (x: unknown) => (typeof x === "string" ? x : x == null ? "" : String(x));
const isEmail = (v: unknown): v is string =>
  typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function currencyUSD(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function buildReplyHtml(missing: string[], price?: { unitPrice: number; total: number }) {
  const priceBlock = price
    ? `<p>Here’s a quick price based on what you shared:</p>
       <div style="margin:8px 0 12px 0">
         <div><strong>Unit price</strong> ${currencyUSD(price.unitPrice)}</div>
         <div><strong>Total</strong> ${currencyUSD(price.total)}</div>
       </div>`
    : "";

  const ask =
    missing.length > 0
      ? `To lock in pricing, could you confirm:<ul style="margin:0 0 12px 18px;padding:0">${missing
          .slice(0, 4)
          .map((m) => `<li>${m}</li>`)
          .join("")}</ul>`
      : "If you have a sketch or photo, attach it — it helps confirm cavity sizes and clearances.";

  return `
  <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
    <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
    ${priceBlock}
    <p>${ask}</p>
    <p style="margin-top:16px">— Alex-IO Estimator</p>
  </div>`.trim();
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/ai/orchestrate" });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as OrchestrateInput;

    const url = new URL(req.url);
    const SELF = process.env.INTERNAL_SELF_URL || `${url.protocol}//${url.host}`;

    const toEmail = s(body.toEmail);
    if (!isEmail(toEmail)) return NextResponse.json({ ok: false, error: "invalid_toEmail" }, { status: 400 });

    const subject = s(body.subject) || "Re: your message to Alex-IO";
    const raw = s(body.text ?? "");

    // ---------- NEW: config-driven extraction ----------
    const { slots, sources } = extractSlots(raw);

    // defaults / normalization
    const filled: SlotMap = { ...slots };
    if (filled.thickness_under_in == null)
      filled.thickness_under_in = Number(process.env.DEFAULT_UNDER_IN ?? "0.5");
    if (filled.cavities == null) filled.cavities = 1;

    // Detect missing pieces
    const missing: string[] = [];
    if (filled.internal_length_in == null || filled.internal_width_in == null || filled.internal_height_in == null) {
      missing.push("final outside dimensions (L × W × H)");
    }
    if (filled.qty == null || filled.qty <= 0) missing.push("quantity");
    if (filled.thickness_under_in == null) missing.push("thickness under the part");

    // Optional price call (only when all required fields present)
    let priced: { unitPrice: number; total: number } | undefined;
    if (missing.length === 0) {
      const res = await fetch(`${SELF}/api/ai/price`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: filled }),
      });
      const pj = await res.json().catch(() => ({}));
      if (res.ok && pj?.ok && Number.isFinite(pj.unitPrice) && Number.isFinite(pj.total)) {
        priced = { unitPrice: pj.unitPrice, total: pj.total };
      }
    }

    // Threading: try incoming header, then KV fallback
    const kv = makeKv();
    const kvKey = `alexio:mid:${toEmail.toLowerCase()}`;
    let inReplyTo = s(body.inReplyTo);
    if (!inReplyTo) {
      const fallbackMid = await kv.get(kvKey).catch(() => null);
      if (fallbackMid) inReplyTo = String(fallbackMid);
    }

    const html = buildReplyHtml(missing, priced);

    if (body.dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        to: toEmail,
        subject,
        htmlPreview: html,
        missingDetected: missing,
        inReplyTo: inReplyTo || null,
        extracted: filled,
        src: sources,
      });
    }

    // Live send — try /api/ms/send first, fall back to /api/msgraph/send
    const payload = { to: toEmail, subject, html, inReplyTo: inReplyTo || undefined };

    // 1) new route
    let sendRes = await fetch(`${SELF}/api/ms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // 2) fallback (legacy)
    if (!sendRes.ok) {
      sendRes = await fetch(`${SELF}/api/msgraph/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    const sendJson = await sendRes.json().catch(() => ({}));
    if (!sendRes.ok || sendJson?.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          error: "graph_send_failed",
          status: sendRes.status,
          detail: sendJson?.error ?? sendJson,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      to: toEmail,
      subject,
      graph: { status: sendRes.status, route: sendRes.url.includes("/ms/") ? "/api/ms/send" : "/api/msgraph/send", note: "live" },
      missingDetected: missing,
      usedInReplyTo: inReplyTo || null,
      extracted: filled,
      src: sources,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "orchestrate_exception" }, { status: 500 });
  }
}
