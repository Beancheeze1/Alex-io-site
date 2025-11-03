// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { parseSpecs } from "@/app/lib/nlp";
import { loadContext, saveContext } from "@/app/lib/contextcache"; // <-- lowercase
import { buildEstimate } from "@/app/lib/quoteEngine";

export const dynamic = "force-dynamic";

type OrchestrateIn = {
  text?: string;
  toEmail?: string;
  subject?: string;
  messageId?: string;
  threadId?: string;
  dryRun?: boolean | string | number;
};

function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return /^(1|true|yes|on)$/i.test(v);
  return false;
}

function baseUrlFrom(req: NextRequest) {
  const envUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.VERCEL_URL ||
    "";
  if (envUrl) return envUrl.startsWith("http") ? envUrl : `https://${envUrl}`;
  return `${req.nextUrl.origin}`;
}

export async function POST(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const payload = (await req.json().catch(() => ({}))) as OrchestrateIn;

    const text = (payload.text ?? "").trim();
    const toEmail = (payload.toEmail ?? "").trim();
    const userSubject = (payload.subject ?? "").trim();
    const threadKey =
      (payload.threadId || payload.messageId || userSubject || toEmail || "")
        .toString()
        .trim();

    const dryRun = asBool(payload.dryRun ?? q.get("dryRun") ?? q.get("t"));

    if (!text) {
      return NextResponse.json(
        { ok: false, error: "missing_text", detail: "POST body must include { text }." },
        { status: 400 }
      );
    }

    const ctxKey = threadKey ? `conv:${threadKey}` : "";
    const prior = ctxKey ? await loadContext(ctxKey) : null;

    const now = parseSpecs(text);
    const merged = {
      dims: now.dims ?? prior?.dims ?? null,
      qty: now.qty ?? prior?.qty ?? null,
      density: now.density ?? prior?.density ?? null,
      material: now.material ?? prior?.material ?? null,
      productType: now.productType ?? prior?.productType ?? null,
      notes: now.notes?.length ? now.notes : prior?.notes ?? [],
      lastMessage: text,
      updatedAt: Date.now(),
    };

    const missing: string[] = [];
    if (!merged.dims) missing.push("length × width × height in inches");
    if (!merged.qty) missing.push("quantity");
    if (!merged.material) missing.push("foam type (PE/EPE/PU)");
    if (!merged.density) missing.push("density (e.g. 1.7 lb/ft³)");

    if (missing.length > 0) {
      const ask =
        missing.length === 1
          ? `Could you confirm the ${missing[0]}?`
          : `I’m missing a couple details: ${missing
              .map((m) => `\n• ${m}`)
              .join("")}\n\nReply with the missing info in any order.`;

      const subject =
        userSubject && /re:/i.test(userSubject)
          ? userSubject
          : `[Alex-IO] Quick question to finish your quote`;

      if (ctxKey) await saveContext(ctxKey, merged);

      const result = await maybeSendViaGraph({
        req,
        toEmail,
        subject,
        text: ask,
        dryRun,
      });

      return NextResponse.json({
        ok: true,
        mode: "ask",
        toEmail,
        subject,
        dryRun: result.dryRun,
        graph: result.graph,
        nextExpected: missing,
      });
    }

    const est = buildEstimate({
      dims: merged.dims!,
      qty: merged.qty!,
      density: merged.density!,
      material: merged.material!,
      productType: merged.productType ?? "insert",
    });

    const subject =
      userSubject && /re:/i.test(userSubject)
        ? userSubject
        : `[Alex-IO] Estimate for ${est.summary}`;

    const body = [
      `Thanks — I ran the numbers:`,
      ``,
      `• Item: ${est.summary}`,
      `• Qty: ${est.qty}`,
      `• Foam: ${est.material} @ ${est.density.toFixed(2)} lb/ft³`,
      `• Waste factor: ${Math.round(est.wastePct * 100)}%`,
      `• Price per unit (est): $${est.unitPrice.toFixed(2)}`,
      `• Total (est): $${est.total.toFixed(2)} (min charge $${est.minCharge.toFixed(
        2
      )} already applied if higher)`,
      ``,
      `Notes: ${est.notes.join(" ") || "—"}`,
      ``,
      `If any spec looks off, reply with the correction (e.g. “make density 2.2” or “qty 75”).`,
    ].join("\n");

    if (ctxKey) await saveContext(ctxKey, { ...merged, estimate: est });

    const result = await maybeSendViaGraph({
      req,
      toEmail,
      subject,
      text: body,
      dryRun,
    });

    return NextResponse.json({
      ok: true,
      mode: "estimate",
      toEmail,
      subject,
      dryRun: result.dryRun,
      graph: result.graph,
      estimate: est,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "orchestrate_failed", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

async function maybeSendViaGraph(args: {
  req: NextRequest;
  toEmail?: string;
  subject: string;
  text: string;
  dryRun: boolean;
}) {
  const { req, toEmail, subject, text, dryRun } = args;

  if (!toEmail) {
    return { dryRun: true, graph: { status: 200, note: "No toEmail; echo only." } };
  }

  if (dryRun) {
    return {
      dryRun: true,
      graph: { status: 200, route: "/api/msgraph/send", note: "dryRun:true" },
    };
  }

  const base = baseUrlFrom(req);
  const url = `${base}/api/msgraph/send`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: toEmail, subject, text }),
  }).catch((e) => ({
    ok: false,
    status: 502,
    json: async () => ({ error: String(e) }),
  }));

  const graph = {
    status: (res as any).status ?? 500,
    ...(await (res as any).json().catch(() => ({}))),
  };

  return { dryRun: false, graph };
}
