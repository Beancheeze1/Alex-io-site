// app/api/ai/orchestrate/route.ts
//
// PATH-A SAFE VERSION
// - Hybrid regex + LLM parser
// - Cavity durability + DIA normalization
// - DB enrichment for material
// - Quote calc via /api/quotes/calc
// - Quote template rendering with missing-specs list
// - Stable quoteNumber per thread
// - NEW: Always store quote header when we have dims + qty + quoteNumber,
//   and only store line items once material_id is known.

import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts, LAST_STORE } from "@/app/lib/memory";
import { one } from "@/lib/db";
import { renderQuoteEmail } from "@/app/lib/email/quoteTemplate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ===================== Types & helpers ===================== */

type In = {
  mode?: string;
  toEmail?: string;
  subject?: string;
  text?: string;
  threadId?: string | number;
  threadMsgs?: any[];
  dryRun?: boolean;
};
type Mem = Record<string, any>;

function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}

function err(error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail }, { status: 200 });
}

function compact<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (
      v === undefined ||
      v === null ||
      (typeof v === "number" && !Number.isFinite(v))
    ) {
      continue;
    }
    out[k] = v;
  }
  return out as T;
}

function parseDims(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.replace(/[xX]/g, "x");
}

function parseDimsNums(dims: string | null | undefined) {
  if (!dims) return { L: null as number | null, W: null as number | null, H: null as number | null };
  const m = dims.match(
    /([0-9]*\.?[0-9]+)\s*[xX]\s*([0-9]*\.?[0-9]+)\s*[xX]\s*([0-9]*\.?[0-9]+)/
  );
  if (!m) return { L: null, W: null, H: null };
  return {
    L: parseFloat(m[1]),
    W: parseFloat(m[2]),
    H: parseFloat(m[3])
  };
}

function parseQty(raw: any): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Normalize DIA cavity notation and keep durability. */
function normalizeCavity(cavity: string): string {
  if (!cavity) return "";
  let s = cavity.trim();
  s = s.replace(/\b(dia|diameter)\b/gi, "DIA");
  s = s.replace(/ø/gi, "DIA ");
  s = s.replace(/[^0-9a-zA-Z.\s"]/g, " ");
  s = s.replace(/\s+/g, " ");
  return s.trim();
}

/** Apply cavity normalization to merged facts. */
function applyCavityNormalization(f: Mem): Mem {
  if (!f) return f;
  if (Array.isArray(f.cavityDims)) {
    f.cavityDims = f.cavityDims.map((c: any) =>
      typeof c === "string" ? normalizeCavity(c) : c
    );
  }
  if (typeof f.cavitySummary === "string") {
    f.cavitySummary = normalizeCavity(f.cavitySummary);
  }
  return f;
}

/* ===================== DB helpers ===================== */

async function enrichMaterial(
  f: Mem
): Promise<{
  material_id: number | null;
  material_name: string | null;
  density_lb_ft3: number | null;
  kerf_pct: number | null;
  min_charge: number | null;
}> {
  const materialName =
    f.material_name || f.material || f.foam_family || f.foam || "";
  const density =
    f.density_pcf != null ? Number(f.density_pcf) : f.density != null ? Number(f.density) : null;

  if (!materialName && !density) {
    return {
      material_id: f.material_id || null,
      material_name: f.material_name || null,
      density_lb_ft3: f.density_pcf || null,
      kerf_pct: f.kerf_pct || null,
      min_charge: f.min_charge || null
    };
  }

  const like = `%${materialName}%`;

  const densNum =
    density != null && Number.isFinite(density) ? density : 0;

  try {
    const row = await one<{
      id: number;
      name: string;
      density_lb_ft3: number | null;
      kerf_waste_pct: number | null;
      min_charge_usd: number | null;
    }>(
      `
      SELECT id, name, density_lb_ft3, kerf_waste_pct, min_charge_usd
      FROM materials
      WHERE active = true
        AND (name ILIKE $1 OR category ILIKE $1 OR subcategory ILIKE $1)
      ORDER BY ABS(COALESCE(density_lb_ft3, 0) - $2)
      LIMIT 1;
      `,
      [like, densNum]
    );

    if (row) {
      if (!f.material_id) f.material_id = row.id;
      if (!f.material_name) f.material_name = row.name;
      if (!f.density_pcf && row.density_lb_ft3 != null) {
        f.density_pcf = row.density_lb_ft3;
      }
      if (!f.kerf_pct && row.kerf_waste_pct != null) {
        f.kerf_pct = row.kerf_waste_pct;
      }
      if (!f.min_charge && row.min_charge_usd != null) {
        f.min_charge = row.min_charge_usd;
      }

      return {
        material_id: row.id,
        material_name: row.name,
        density_lb_ft3: row.density_lb_ft3,
        kerf_pct: row.kerf_waste_pct,
        min_charge: row.min_charge_usd
      };
    }
  } catch (err) {
    console.error("enrichMaterial query error", err);
  }

  return {
    material_id: f.material_id || null,
    material_name: f.material_name || null,
    density_lb_ft3:
      f.density_pcf != null && Number.isFinite(Number(f.density_pcf))
        ? Number(f.density_pcf)
        : null,
    kerf_pct: f.kerf_pct || null,
    min_charge: f.min_charge || null
  };
}

/* ===================== Quotes calc proxy ===================== */

async function callCalcAPI(opts: {
  dims: string;
  qty: number;
  material_id: number;
  cavities?: string[] | null;
  round_to_bf: boolean;
}) {
  const { L, W, H } = parseDimsNums(opts.dims);
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

  const r = await fetch(`${base}/api/quotes/calc?t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      length_in: L,
      width_in: W,
      height_in: H,
      material_id: opts.material_id,
      qty: opts.qty,
      cavities: opts.cavities || null,
      round_to_bf: opts.round_to_bf
    })
  });

  const json = await r.json().catch(() => ({} as any));
  if (!r.ok || !json?.ok) {
    throw new Error(
      `calc_api_failed: ${r.status} ${(json && json.error) || ""}`.trim()
    );
  }
  return json.result;
}

/* ===================== Main handler ===================== */

export async function POST(req: NextRequest) {
  try {
    const p = (await req.json().catch(() => ({}))) as In;

    const dryRun = !!p.dryRun;
    const mode = p.mode || "ai";

    const bodyText =
      p.text && typeof p.text === "string" ? p.text : "";

    const threadKey =
      p.threadId != null
        ? `thread:${String(p.threadId)}`
        : p.threadMsgs && p.threadMsgs.length
        ? `thread:${LAST_STORE}`
        : null;

    let loaded: Mem = {};
    if (threadKey) {
      const stored = await loadFacts(threadKey);
      loaded = stored || {};
    }

    const newly: Mem = {};
    newly.rawText = bodyText;

    const emailLower = bodyText.toLowerCase();

    const dimsMatch =
      bodyText.match(
        /([0-9]*\.?[0-9]+)\s*[xX]\s*([0-9]*\.?[0-9]+)\s*[xX]\s*([0-9]*\.?[0-9]+)/
      ) || null;
    if (dimsMatch) {
      newly.dims = `${dimsMatch[1]}x${dimsMatch[2]}x${dimsMatch[3]}`;
    }

    const qtyMatch =
      bodyText.match(
        /\b(?:qty|quantity|pieces?|pcs?)[:\s]*([0-9]{1,6})\b/i
      ) || bodyText.match(/\b([0-9]{1,6})\s*(?:pcs?|pieces?)\b/i);
    if (qtyMatch) {
      newly.qty = Number(qtyMatch[1]);
    }

    const densMatch =
      bodyText.match(
        /\b([0-9]{1,2}(?:\.[0-9])?)\s*(?:pcf|lb\/?ft3?|lb per cubic foot)\b/i
      ) || bodyText.match(/\b([0-9]{1,2}(?:\.[0-9])?)\s*#\b/);
    if (densMatch) {
      newly.density_pcf = Number(densMatch[1]);
    }

    if (/polyethylene|pe foam|pe\s+foam/i.test(emailLower)) {
      newly.foam_family = "PE";
    } else if (/polyurethane|urethane|pu foam|pu\s+foam/i.test(emailLower)) {
      newly.foam_family = "Polyurethane";
    }

    const nameMatch =
      bodyText.match(/(?:hello|hi|hey)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ||
      bodyText.match(/(?:this is|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (nameMatch) {
      newly.customerName = nameMatch[1];
    }

    const emailMatch = bodyText.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
    );
    if (emailMatch) {
      newly.email = emailMatch[0];
    }

    const cavities: string[] = [];
    const cavityRegex =
      /\b(?:cavity|cavities|pockets?)\b[^.\n]*\b([0-9]{1,3}(?:\.[0-9])?)\s*[xX]\s*([0-9]{1,3}(?:\.[0-9])?)\s*[xX]\s*([0-9]{1,3}(?:\.[0-9])?)\b/g;
    let m: RegExpExecArray | null;
    while ((m = cavityRegex.exec(bodyText)) != null) {
      const c = `${m[1]}x${m[2]}x${m[3]}`;
      cavities.push(normalizeCavity(c));
    }

    const diaRegex =
      /\b(?:cavity|cavities|pockets?)\b[^.\n]*\b(?:ø|DIA|dia|diameter)\s*([0-9]{1,3}(?:\.[0-9])?)\s*[xX]\s*([0-9]{1,3}(?:\.[0-9])?)\b/g;
    while ((m = diaRegex.exec(bodyText)) != null) {
      const c = `DIA ${m[1]}x${m[2]}`;
      cavities.push(normalizeCavity(c));
    }

    if (cavities.length) {
      newly.cavityDims = cavities;
      newly.cavityCount = cavities.length;
    }

    if (threadKey && p.threadMsgs && p.threadMsgs.length) {
      const lastMsg = p.threadMsgs[p.threadMsgs.length - 1];
      if (lastMsg && lastMsg.internetMessageId) {
        newly.__lastInternetMessageId = lastMsg.internetMessageId;
      }
    }

    let merged: Mem = { ...loaded, ...newly };
    merged = applyCavityNormalization(merged);
    merged.__turnCount = (merged.__turnCount || 0) + 1;

    if (!merged.quoteNumber && !merged.quote_no) {
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(now.getUTCDate()).padStart(2, "0");
      const hh = String(now.getUTCHours()).padStart(2, "0");
      const mi = String(now.getUTCMinutes()).padStart(2, "0");
      const ss = String(now.getUTCSeconds()).padStart(2, "0");
      const autoNo = `Q-AI-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
      merged.quoteNumber = autoNo;
      merged.quote_no = autoNo;
    } else if (!merged.quoteNumber && merged.quote_no) {
      merged.quoteNumber = merged.quote_no;
    }

    if (!merged.status) {
      merged.status = "draft";
    }

    const dims = parseDims(merged.dims);
    const dimsNums = parseDimsNums(dims || "");
    const qty = parseQty(merged.qty);

    const { material_id, material_name, density_lb_ft3, kerf_pct, min_charge } =
      await enrichMaterial(merged);

    merged.material_id = material_id;
    merged.material_name = material_name;
    merged.density_pcf =
      merged.density_pcf ??
      (density_lb_ft3 != null ? density_lb_ft3 : merged.density_pcf);
    merged.kerf_pct = merged.kerf_pct ?? kerf_pct;
    merged.min_charge = merged.min_charge ?? min_charge;

    if (threadKey) {
      await saveFacts(threadKey, merged);
    }

    const dimsStr = dims || merged.dims || "";
    const specs = {
      dims: dimsStr,
      qty: qty ?? merged.qty ?? null,
      material: merged.material_name || merged.foam_family || merged.material,
      density_pcf:
        merged.density_pcf != null && Number.isFinite(Number(merged.density_pcf))
          ? Number(merged.density_pcf)
          : null
    };

    if (mode === "facts") {
      return ok({ mode, facts: merged, specs });
    }

    let calc: any = null;
    if (dimsStr && qty && material_id) {
      try {
        const roundToBf = !!merged.round_to_bf;
        const cavDims = Array.isArray(merged.cavityDims)
          ? (merged.cavityDims as string[])
          : null;
        calc = await callCalcAPI({
          dims: dimsStr,
          qty,
          material_id,
          cavities: cavDims,
          round_to_bf: roundToBf
        });
      } catch (e: any) {
        console.error("callCalcAPI failed", e);
      }
    }

    const opener =
      merged.customerName || merged.name
        ? `Hi ${merged.customerName || merged.name},`
        : "Hi there,";

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    const hasDimsQty = !!(specs.dims && specs.qty);

    let quoteId = merged.quote_id || null;
    if (!quoteId && merged.quote_id != null) {
      quoteId = merged.quote_id;
    }

    if (merged.quoteNumber && hasDimsQty && !quoteId) {
      try {
        const customerName =
          merged.customerName ||
          merged.customer_name ||
          merged.name ||
          "Customer";
        const customerEmail =
          merged.customerEmail ||
          merged.email ||
          null;
        const phone = merged.phone || null;
        const status = merged.status || "draft";

        const headerRes = await fetch(`${base}/api/quotes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote_no: String(merged.quoteNumber),
            customer_name: String(customerName),
            email: customerEmail,
            phone,
            status
          })
        });

        const headerJson = await headerRes.json().catch(() => ({} as any));
        if (headerRes.ok && headerJson?.ok && headerJson.quote?.id) {
          quoteId = headerJson.quote.id;
          merged.quote_id = quoteId;
          merged.status = headerJson.quote.status || merged.status;
          if (threadKey) await saveFacts(threadKey, merged);
        }
      } catch (err) {
        console.error("quote header store error", err);
      }
    }

    if (quoteId && calc && calc.id && !calc.quote_id) {
      try {
        await fetch(`${base}/api/quotes/${quoteId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            length_in: calc.length_in,
            width_in: calc.width_in,
            height_in: calc.height_in,
            qty: calc.qty,
            material_id: calc.material_id,
            cavities: calc.cavities || null,
            round_to_bf: !!merged.round_to_bf,
            raw: calc
          })
        });
      } catch (err) {
        console.error("quote items store error", err);
      }
    }

    if (mode === "calc") {
      return ok({
        mode,
        specs,
        calc,
        facts: merged
      });
    }

    const templateInput = {
      customerLine: opener,
      quoteNumber: merged.quoteNumber || merged.quote_no,
      status: merged.status || "draft",
      specs: {
        L_in: dimsNums.L,
        W_in: dimsNums.W,
        H_in: dimsNums.H,
        qty: specs.qty,
        density_pcf:
          merged.density_pcf != null && Number.isFinite(Number(merged.density_pcf))
            ? Number(merged.density_pcf)
            : null,
        foam_family: specs.material,
        thickness_under_in: merged.thickness_under_in,
        color: merged.color
      },
      material: {
        name: merged.material_name,
        density_lbft3:
          merged.density_pcf != null && Number.isFinite(Number(merged.density_pcf))
            ? Number(merged.density_pcf)
            : null,
        kerf_pct: merged.kerf_pct,
        min_charge: merged.min_charge
      },
      pricing: {
        total: calc?.price_total ?? calc?.total ?? 0,
        piece_ci: calc?.piece_ci,
        order_ci: calc?.order_ci,
        order_ci_with_waste: calc?.order_ci_with_waste,
        used_min_charge: calc?.min_charge_applied
      },
      missing: (() => {
        const miss: string[] = [];
        if (!merged.dims) miss.push("Dimensions");
        if (!merged.qty) miss.push("Quantity");
        if (!merged.material) miss.push("Material");
        if (!merged.density) miss.push("Density");
        if (
          merged.cavityCount > 0 &&
          (!merged.cavityDims || merged.cavityDims.length === 0)
        ) {
          miss.push("Cavity sizes");
        }
        return miss;
      })(),
      facts: merged
    };

    let htmlBody = "";
    try {
      htmlBody = renderQuoteEmail(templateInput);
    } catch {
      htmlBody = `<p>${opener}</p>`;
    }

    const toEmail = p.toEmail || merged.email || merged.customerEmail;
    if (!toEmail) {
      return ok({
        dryRun: true,
        reason: "missing_toEmail",
        htmlPreview: htmlBody,
        specs,
        calc,
        facts: merged
      });
    }

    const inReplyTo = merged.__lastInternetMessageId || undefined;

    if (dryRun) {
      return ok({
        mode: "dryrun",
        htmlPreview: htmlBody,
        specs,
        calc,
        facts: merged
      });
    }

    const sendUrl = `${base}/api/msgraph/send`;

    const r = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail,
        subject: p.subject || "Foam quote",
        html: htmlBody,
        inReplyTo
      })
    });

    const sent = await r.json().catch(() => ({} as any));

    if (threadKey && (sent.messageId || sent.internetMessageId)) {
      merged.__lastGraphMessageId =
        sent.messageId || merged.__lastGraphMessageId;
      merged.__lastInternetMessageId =
        sent.internetMessageId || merged.__lastInternetMessageId;
      await saveFacts(threadKey, merged);
    }

    // After a successful real send, bump quote status to "sent" and persist.
    // This keeps the /quote print view and admin lists in sync with reality.
    if (merged.quoteNumber || merged.quote_no) {
      const quote_no = String(merged.quoteNumber || merged.quote_no);
      const customerName =
        merged.customerName ||
        merged.customer_name ||
        merged.name ||
        "Customer";
      const customerEmail =
        merged.customerEmail ||
        merged.email ||
        null;
      const phone = merged.phone || null;

      try {
        const res = await fetch(`${base}/api/quotes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote_no,
            customer_name: String(customerName),
            email: customerEmail,
            phone,
            status: "sent"
          })
        });
        const js = await res.json().catch(() => ({} as any));
        if (res.ok && js?.ok && js.quote?.status) {
          merged.status = js.quote.status;
        } else {
          merged.status = "sent";
        }
        if (threadKey) {
          await saveFacts(threadKey, merged);
        }
      } catch (err) {
        console.error("quote status update error", err);
      }
    }

    return ok({
      sent: true,
      toEmail,
      messageId: sent.messageId,
      internetMessageId: sent.internetMessageId,
      specs,
      calc,
      facts: merged
    });
  } catch (e: any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
