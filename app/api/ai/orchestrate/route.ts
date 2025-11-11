// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts, LAST_STORE } from "@/app/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function ok(extra: Record<string, any> = {}) { return NextResponse.json({ ok: true, ...extra }, { status: 200 }); }
function err(error: string, detail?: any) { return NextResponse.json({ ok: false, error, detail }, { status: 200 }); }

function compact<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) out[k] = v;
  }
  return out as T;
}
function mergeFacts(a: Mem, b: Mem): Mem { return { ...(a || {}), ...compact(b || {}) }; }

function pickThreadContext(threadMsgs: any[] = []): string {
  const take = threadMsgs.slice(-3);
  const snippets = take
    .map((m) => String(m?.text || m?.body || m?.content || "").trim())
    .filter(Boolean)
    .map((s) => (s.length > 200 ? s.slice(0, 200) + "…" : s));
  return snippets.join("\n---\n");
}

/* ----------------- Canonical helpers ----------------- */

function pickDensityAnywhere(t: string): string | undefined {
  const s = t.toLowerCase();
  const labeled =
    s.match(/density\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs|#|pounds?)/) ||
    s.match(/#\s*(\d+(?:\.\d+)?)\s*(?:density)?\b/);
  if (labeled) return `${labeled[1]}lb`;
  const free =
    s.match(/(?:^|[^0-9.])(\d+(?:\.\d+)?)\s*(?:lb|lbs|#)\b/) ||
    s.match(/#\s*(\d+(?:\.\d+)?)(?![0-9])/);
  if (free) return `${free[1]}lb`;
  return undefined;
}

// Cavity count anywhere: "cavities: 3", "3 cavities", "two cutouts" (we only catch numerics)
function pickCavitiesAnywhere(t: string): number | undefined {
  const s = t.toLowerCase();
  const m =
    s.match(/\b(?:cavities|cavity|cutouts?|pockets?|slots?)\s*[:\-]?\s*(\d{1,4})\b/) ||
    s.match(/\b(\d{1,4})\s*(?:cavities|cavity|cutouts?|pockets?|slots?)\b/);
  if (m) return Number(m[1]);
  return undefined;
}

// Single cavity size like "cavity: 2x3x1" or "cutout 2 x 3"
function pickCavityDimsAnywhere(t: string): string | undefined {
  const s = t.toLowerCase().replace(/×/g, "x");
  const m =
    s.match(/(?:cavity|cutout|pocket|slot)\s*(?:size|dims?)?\s*[:\-]?\s*([0-9.]+\s*x\s*[0-9.]+(?:\s*x\s*[0-9.]+)?)/) ||
    s.match(/([0-9.]+\s*x\s*[0-9.]+(?:\s*x\s*[0-9.]+)?)\s*(?:cavity|cutout|pocket|slot)\b/);
  if (m) return m[1].replace(/\s+/g, "");
  return undefined;
}

/* ----------------- Labeled & free-text extraction ----------------- */

function extractLabeledLines(s: string): Mem {
  const out: Mem = {};
  const lines = (s || "").split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    const t = raw.toLowerCase().replace(/^•\s*/, "").replace(/×/g, "x");

    // Dimensions
    const mDims = t.match(/^dimensions?\s*[:\-]\s*([0-9.]+\s*x\s*[0-9.]+\s*x\s*[0-9.]+)/);
    if (mDims) out.dims = mDims[1].replace(/\s+/g, "");

    // Quantity
    const mQty = t.match(/^qty(?:uantity)?\s*[:\-]\s*(\d{1,6})\b/);
    if (mQty) out.qty = Number(mQty[1]);

    // Material (allow density on same line)
    if (/^material\s*[:\-]/.test(t)) {
      if (/\bpe\b|\bpolyethylene\b/.test(t)) out.material = "PE";
      else if (/\bepe\b|expanded\s*pe/.test(t)) out.material = "EPE";
      else if (/\bpu\b|\bpolyurethane\b/.test(t)) out.material = "PU";
      const d = pickDensityAnywhere(t);
      if (d) out.density = d;
    }

    // Density (explicit)
    const mDen = t.match(/^density\s*[:\-]\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs|#|pounds?)\b/) || t.match(/^#\s*(\d+(?:\.\d+)?)/);
    if (mDen) out.density = `${mDen[1]}lb`;

    // Cavities count (explicit)
    const mCav = t.match(/^(?:cavities|cavity|cutouts?|pockets?|slots?)\s*[:\-]\s*(\d{1,4})\b/);
    if (mCav) out.cavities = Number(mCav[1]);

    // Cavity dims on this line
    const cd = pickCavityDimsAnywhere(t);
    if (cd) out.cavity_dims = cd;

    // Line-level fallbacks
    if (!out.density) {
      const d2 = pickDensityAnywhere(raw);
      if (d2) out.density = d2;
    }
    if (out.cavities === undefined) {
      const c2 = pickCavitiesAnywhere(raw);
      if (c2 !== undefined) out.cavities = c2;
    }
    if (!out.cavity_dims) {
      const cd2 = pickCavityDimsAnywhere(raw);
      if (cd2) out.cavity_dims = cd2;
    }
  }
  return out;
}

function extractFreeText(s = ""): Mem {
  const t = (s || "").toLowerCase().replace(/×/g, "x");

  const dimsMatch =
    t.match(/\b(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/);

  const qtyMatch =
    t.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/) ||
    t.match(/\bquantity\s*[:=]?\s*(\d{1,6})\b/) ||
    t.match(/\b(\d{1,6})\s*(pcs?|pieces?)\b/);

  const density = pickDensityAnywhere(t);
  const cavities = pickCavitiesAnywhere(t);
  const cavity_dims = pickCavityDimsAnywhere(t);

  let material: string | undefined;
  if (/\bpolyethylene\b|\bpe\b/.test(t)) material = "PE";
  else if (/\bexpanded\s*pe\b|\bepe\b/.test(t)) material = "EPE";
  else if (/\bpolyurethane\b|\bpu\b/.test(t)) material = "PU";

  return compact({
    dims:    dimsMatch ? `${dimsMatch[1]}x${dimsMatch[2]}x${dimsMatch[3]}` : undefined,
    density,
    qty:     qtyMatch ? Number(qtyMatch[1]) : undefined,
    material,
    cavities,
    cavity_dims,
  });
}

function extractFromSubject(s = ""): Mem {
  if (!s) return {};
  const m = extractFreeText(s);
  if (!m.density) {
    const d = pickDensityAnywhere(s);
    if (d) m.density = d;
  }
  if (m.cavities === undefined) {
    const c = pickCavitiesAnywhere(s);
    if (c !== undefined) m.cavities = c;
  }
  if (!m.cavity_dims) {
    const cd = pickCavityDimsAnywhere(s);
    if (cd) m.cavity_dims = cd;
  }
  return m;
}

/* ----------------- Stable alias key ----------------- */

function normalizeEmail(s: string) {
  return String(s || "").trim().toLowerCase();
}
function subjectRoot(s: string) {
  let t = String(s || "").toLowerCase().trim();
  t = t.replace(/^(re|fwd?|aw):\s*/g, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
function makeAlias(toEmail?: string, subject?: string) {
  const e = normalizeEmail(toEmail || "");
  const r = subjectRoot(subject || "");
  if (!e || !r) return "";
  return `hsu:${e}::${r}`;
}

/* ----------------- AI opener (optional) ----------------- */

async function aiOpener(lastInbound: string, context: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    const prompt = [
      "Write ONE short, natural sentence acknowledging the message and saying you'll price it once specs are confirmed.",
      "No bullets, no footer.",
      context ? `Context:\n${context}` : "",
      `Customer message:\n${lastInbound || "(none)"}`,
    ].filter(Boolean).join("\n\n");

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4.1-mini", input: prompt, max_output_tokens: 60 }),
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    const text =
      j?.output_text ||
      j?.output?.[0]?.content?.[0]?.text ||
      j?.choices?.[0]?.message?.content?.[0]?.text ||
      j?.choices?.[0]?.message?.content ||
      j?.choices?.[0]?.text || "";
    const one = String(text || "").trim().replace(/\s+/g, " ");
    return one || null;
  } catch {
    return null;
  }
}

/* ----------------- Q&A composer (no bullets) ----------------- */

function haveCore(f: Mem) {
  return !!(f.dims && f.qty && f.material && f.density);
}

// Build a conversational email that only asks for what's missing.
// No bullets, just short Q&A-style lines.
function composeQA(f: Mem, opener?: string | null): string {
  const lines: string[] = [];
  lines.push(opener || "Thanks for the details—happy to help you get a quick quote.");

  // Short recap sentence if we have anything
  const recapBits: string[] = [];
  if (f.dims) recapBits.push(`dimensions ${f.dims}`);
  if (typeof f.qty === "number") recapBits.push(`quantity ${f.qty}`);
  if (f.material) recapBits.push(`material ${f.material}`);
  if (f.density) recapBits.push(`${f.density} foam`);
  if (typeof f.cavities === "number") recapBits.push(`${f.cavities} cavities`);
  if (f.cavity_dims) recapBits.push(`cavity size ${f.cavity_dims}`);
  if (recapBits.length) lines.push(`I have: ${recapBits.join("; ")}.`);

  // Ask only for what's missing
  const asks: string[] = [];
  if (!f.dims) asks.push("What are the exact dimensions (L×W×H in inches)?");
  if (f.qty === undefined) asks.push("How many pieces do you need?");
  if (!f.material) asks.push("Which foam material do you prefer (PE, EPE, or PU)?");
  if (!f.density) asks.push("What density would you like (e.g., 1.7 lb)?");

  // Cavities: if not provided, ask yes/no; if count but no size, ask size
  if (f.cavities === undefined) {
    asks.push("Do you need any pockets/cutouts (cavities)? If yes, how many?");
  }
  if (f.cavities !== undefined && !f.cavity_dims) {
    asks.push("What is the approximate size of each cavity (L×W×H in inches)?");
  }

  if (asks.length) {
    lines.push("");
    lines.push(asks.join(" "));
    lines.push("");
    lines.push("Once I have those details, I’ll price it right away.");
  } else {
    // Everything present
    lines.push("");
    lines.push("Great—those specs are complete. I’ll prepare the price now and follow up shortly.");
  }

  return lines.join("\n");
}

/* ----------------- Parse request ----------------- */

async function parse(req: NextRequest): Promise<In> {
  try { const j = await req.json(); if (j && typeof j === "object") return j; } catch {}
  try {
    const t = await req.text();
    let s = t?.trim() ?? "";
    if (!s) return {};
    if (s.startsWith('"') && s.endsWith('"')) s = JSON.parse(s);
    if (s.startsWith("{") && s.endsWith("}")) return JSON.parse(s);
  } catch {}
  return {};
}

/* ------------------------------ route ------------------------------ */

export async function POST(req: NextRequest) {
  try {
    const p = await parse(req);
    const dryRun   = !!p.dryRun;
    const lastText = String(p.text || "");
    const subject  = String(p.subject || "");
    const threadIdRaw = String(p.threadId ?? "").trim();
    const threadId = threadIdRaw ? `hs:${threadIdRaw}` : "";
    const alias    = makeAlias(p.toEmail, subject);
    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];

    // Parse all sources
    const fromTextFree   = extractFreeText(lastText);
    const fromTextLabels = extractLabeledLines(lastText);
    const fromSubject    = extractFromSubject(subject);
    const newly          = mergeFacts(mergeFacts(fromTextFree, fromTextLabels), fromSubject);

    // Final global sweeps
    if (!newly.density) {
      const d = pickDensityAnywhere(lastText);
      if (d) newly.density = d;
    }
    if (newly.cavities === undefined) {
      const c = pickCavitiesAnywhere(lastText);
      if (c !== undefined) newly.cavities = c;
    }
    if (!newly.cavity_dims) {
      const cd = pickCavityDimsAnywhere(lastText);
      if (cd) newly.cavity_dims = cd;
    }

    // Load & merge memory from both keys
    let loadedPrimary: Mem = {};
    let loadedAlias: Mem = {};
    if (threadId) loadedPrimary = await loadFacts(threadId).catch(()=> ({}));
    if (alias)    loadedAlias   = await loadFacts(alias).catch(()=> ({}));

    const carry = {
      __lastMessageId: loadedPrimary?.__lastMessageId || loadedAlias?.__lastMessageId || "",
      __lastInternetMessageId: loadedPrimary?.__lastInternetMessageId || loadedAlias?.__lastInternetMessageId || "",
      __lastGraphMessageId: loadedPrimary?.__lastGraphMessageId || loadedAlias?.__lastGraphMessageId || "",
    };

    const merged = mergeFacts(mergeFacts(mergeFacts(loadedPrimary, loadedAlias), carry), newly);

    console.log("[facts] keys { primary:", threadId || "(none)", ", alias:", alias || "(none)", "}");
    console.log("[facts] loaded_primary_keys:", Object.keys(loadedPrimary || {}).join(",") || "(none)");
    console.log("[facts] loaded_alias_keys:", Object.keys(loadedAlias || {}).join(",") || "(none)");
    console.log("[facts] newly:", newly);
    console.log("[facts] merged:", merged);

    // Save to both keys
    const saveTargets: string[] = [];
    if (threadId) saveTargets.push(threadId);
    if (alias)    saveTargets.push(alias);
    await Promise.all(saveTargets.map(k => saveFacts(k, merged)));

    // Build conversational Q&A body
    const context = pickThreadContext(threadMsgs);
    const opener = await aiOpener(lastText, context);
    const body = composeQA(merged, opener);

    // Recipient guardrails
    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    const toEmail = String(p.toEmail || "").trim().toLowerCase();
    if (!toEmail) return err("missing_toEmail", { reason: "Lookup did not produce a recipient; refusing to fall back to mailbox." });
    const ownDomain = mailbox.split("@")[1] || "";
    if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`))) {
      return err("bad_toEmail", { toEmail, reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies." });
    }

    // Thread continuity
    const inReplyTo = String(merged?.__lastInternetMessageId || "").trim() || undefined;

    console.info("[orchestrate] msgraph/send { to:", toEmail, ", dryRun:", !!p.dryRun, ", threadId:", threadId || "<none>", ", alias:", alias || "<none>", ", inReplyTo:", inReplyTo ? "<id>" : "none", ", coreComplete:", haveCore(merged), "}");

    if (dryRun) {
      return ok({
        mode: "dryrun",
        toEmail,
        subject: p.subject || "Quote",
        preview: body.slice(0, 1200),
        facts: merged,
        mem: {
          primaryKey: threadId || null,
          aliasKey: alias || null,
          loadedPrimaryKeys: Object.keys(loadedPrimary),
          loadedAliasKeys: Object.keys(loadedAlias),
          mergedKeys: Object.keys(merged),
        },
        inReplyTo: inReplyTo || null,
        store: LAST_STORE,
      });
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const sendUrl = `${base}/api/msgraph/send`;
    const r = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail,
        subject: p.subject || "Re: your foam quote request",
        text: body,
        inReplyTo: inReplyTo || null,
        dryRun: false
      }),
      cache: "no-store",
    });
    const sent = await r.json().catch(()=> ({}));

    if ((r.ok || r.status === 202) && (sent?.messageId || sent?.internetMessageId)) {
      const updated = {
        ...merged,
        __lastGraphMessageId: sent?.messageId || merged?.__lastGraphMessageId || "",
        __lastInternetMessageId: sent?.internetMessageId || merged?.__lastInternetMessageId || "",
      };
      await Promise.all(saveTargets.map(k => saveFacts(k, updated)));
    }

    return ok({
      sent: r.ok || r.status === 202,
      status: r.status,
      toEmail,
      result: sent?.result || null,
      messageId: sent?.messageId || null,
      internetMessageId: sent?.internetMessageId || null,
      facts: merged,
      store: LAST_STORE,
      primaryKey: threadId || null,
      aliasKey: alias || null,
    });
  } catch (e:any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
