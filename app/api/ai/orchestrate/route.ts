// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

// Use relative paths; aliases sometimes confuse SWC/Render builds.
import * as kvmod from "../../../lib/kv";
import * as nlpmod from "../../../lib/nlp";
import * as ctxmod from "../../../lib/contextcache";
import * as qemod from "../../../lib/quoteEngine";
import * as tplmod from "../../../lib/tpl";
import * as layoutmod from "../../../lib/layout";
import * as sigmod from "../../../lib/signature";

export const dynamic = "force-dynamic";

/* -------------------------- permissive runtime shims -------------------------- */
// Keep these as `any` to avoid type fights with local lib signatures.
const makeKv: any = (kvmod as any).makeKv ?? (() => ({ get: async () => null, set: async () => {} }));

const runNlp: any = (nlpmod as any).runNlp ?? (nlpmod as any).default ?? (async () => ({}));

const getContextAny: any =
  (ctxmod as any).getContext ?? (ctxmod as any).load ?? (ctxmod as any).default;
const upsertContextAny: any =
  (ctxmod as any).upsertContext ?? (ctxmod as any).save ?? (ctxmod as any).default;

const quoteFoamAny: any =
  (qemod as any).quoteFoam ?? (qemod as any).default ?? (async () => ({
    summary: "Estimate unavailable",
    qty: 0,
    material: "unknown",
    density: 0,
    wastePct: 0,
    unitPrice: 0,
    total: 0,
    minCharge: 0,
    notes: [],
  }));

const renderTemplate: any = (tplmod as any).renderTemplate ?? ((_: string, v: any) => ({
  subject: v?.subject ?? "",
  html: v?.html ?? "",
}));
const htmlToText: any = (tplmod as any).htmlToText ?? ((h: string) => h.replace(/<[^>]+>/g, " "));

const shouldWrap: any = (layoutmod as any).shouldWrap ?? (() => true);
const wrapHtml: any = (layoutmod as any).wrapHtml ?? ((opts: any) =>
  typeof opts === "string" ? opts : opts?.html ?? ""
);

const pickSignature: any =
  (sigmod as any).pickSignature ?? (() => ({ key: "(fallback)", html: "" }));

/* -------------------------------- small types -------------------------------- */
type BotTurn = { role: "user" | "assistant"; text: string; at: number };
type BotContext = { key: string; turns: BotTurn[] };

type ParsedSpecs = {
  length?: number;
  width?: number;
  height?: number;
  qty?: number;
  material?: string;
  density?: number;
  notes?: string[];
};

type QuoteResult = {
  summary: string;
  qty: number;
  material: string;
  density: number;
  wastePct: number;
  unitPrice: number;
  total: number;
  minCharge: number;
  notes: string[];
};

/* ------------------------------- local helpers ------------------------------- */
function parseSpecs(text: string): ParsedSpecs {
  const t = text.toLowerCase();
  const specs: ParsedSpecs = { notes: [] };

  const dim = t.match(/(\d+(\.\d+)?)\s*[x×]\s*(\d+(\.\d+)?)\s*[x×]\s*(\d+(\.\d+)?)/);
  if (dim) {
    specs.length = Number(dim[1]);
    specs.width = Number(dim[3]);
    specs.height = Number(dim[5]);
  }

  const qty = t.match(/qty\s*[:\-]?\s*(\d+)/) || t.match(/\b(\d+)\s*pcs?\b/);
  if (qty) specs.qty = Number(qty[1]);

  const dens = t.match(/\b(\d+(\.\d+)?)\s*lb\b/);
  if (dens) specs.density = Number(dens[1]);

  const mat =
    t.match(/\b(epe|pe|polyethylene|foam)\b/)?.[1] ??
    t.match(/\bpu|urethane\b/)?.[0];
  if (mat) specs.material = mat.toUpperCase();

  return specs;
}

async function loadContext(kv: any, key: string): Promise<BotContext> {
  try {
    const loaded = await getContextAny?.(kv, key);
    if (loaded && typeof loaded === "object") return loaded as BotContext;
  } catch {}
  return { key, turns: [] };
}

async function saveContext(kv: any, ctx: BotContext): Promise<void> {
  try {
    await upsertContextAny?.(kv, ctx);
  } catch {}
}

async function buildEstimate(specs: ParsedSpecs): Promise<QuoteResult> {
  return await quoteFoamAny(specs);
}

/* --------------------------------- POST route -------------------------------- */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      toEmail,
      subject: subjIn,
      text = "",
      messageId = "",
      dryRun = false,
      mode = "estimate",
    } = body || {};

    if (!toEmail || !text) {
      return NextResponse.json({ ok: false, error: "missing toEmail or text" }, { status: 400 });
    }

    const kv = makeKv();
    const convKey = messageId || `conv:${toEmail}`;
    const ctx = await loadContext(kv, convKey);

    ctx.turns.push({ role: "user", text, at: Date.now() });

    let specs: ParsedSpecs = {};
    try {
      const nlp = await runNlp(text);
      specs = { ...parseSpecs(text), ...(nlp?.specs ?? {}) };
    } catch {
      specs = parseSpecs(text);
    }

    let estimate: QuoteResult | null = null;
    if (mode === "estimate") {
      estimate = await buildEstimate(specs);
    }

    const signature = pickSignature(ctx); // <-- pass ctx as required now
    const htmlBody =
      estimate
        ? `
<div>
  <p>Thanks! Here's a quick estimate based on your note:</p>
  <ul style="margin:0 0 12px 16px;padding:0;">
    <li><b>Summary:</b> ${estimate.summary}</li>
    <li><b>Qty:</b> ${estimate.qty}</li>
    <li><b>Material:</b> ${estimate.material}</li>
    <li><b>Density:</b> ${estimate.density}</li>
    <li><b>Waste:</b> ${estimate.wastePct}%</li>
    <li><b>Unit Price:</b> $${estimate.unitPrice}</li>
    <li><b>Total:</b> $${estimate.total}</li>
    <li><b>Min Charge:</b> $${estimate.minCharge}</li>
  </ul>
  <p>Reply with any changes (dims, material, quantity, turn time) and I’ll refine it.</p>
  ${signature?.html ?? ""}
</div>`
        : `<div><p>Thanks! I’m reading your message and will follow up shortly.</p>${signature?.html ?? ""}</div>`;

    // layout helpers want an options-like object; not a raw string
    const wrapOpts = { html: htmlBody };
    const wrapped = shouldWrap(wrapOpts) ? wrapHtml(wrapOpts) : htmlBody;
    const textBody = htmlToText(wrapped);
    const subject = estimate
      ? `[Alex-IO] Estimate for ${estimate.summary}`
      : subjIn || "Thanks — running numbers now";

    ctx.turns.push({ role: "assistant", text: textBody.slice(0, 4000), at: Date.now() });
    await saveContext(kv, ctx);

    let graph: any = { route: "/api/msgraph/send", note: "dryRun:true" };
    if (!dryRun) {
      try {
        const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
        const res = await fetch(`${base}/api/msgraph/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: toEmail, subject, text: textBody, html: wrapped }),
        });
        graph = { status: res.status, route: "/api/msgraph/send", note: "live" };
      } catch (e: any) {
        graph = { status: 502, route: "/api/msgraph/send", error: String(e) };
      }
    }

    return NextResponse.json({
      ok: true,
      mode,
      toEmail,
      subject,
      dryRun: !!dryRun,
      estimate: estimate
        ? {
            summary: estimate.summary,
            qty: estimate.qty,
            material: estimate.material,
            density: estimate.density,
            wastePct: estimate.wastePct,
            unitPrice: estimate.unitPrice,
            total: estimate.total,
            minCharge: estimate.minCharge,
            notes: estimate.notes,
          }
        : undefined,
      graph: { "@": `status=${graph.status ?? 200}; route=${graph.route}; note=${graph.note ?? ""}` },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err ?? "orchestrate failed") },
      { status: 500 }
    );
  }
}
