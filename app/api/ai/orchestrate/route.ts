// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts, LAST_STORE } from "@/app/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ------------------------------------------------------------------ *
 * Types & helpers
 * ------------------------------------------------------------------ */
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
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) out[k] = v;
  }
  return out as T;
}
function mergeFacts(a: Mem, b: Mem): Mem {
  return { ...(a || {}), ...compact(b || {}) };
}
function pickThreadContext(threadMsgs: any[] = []): string {
  const take = threadMsgs.slice(-3);
  const snippets = take
    .map((m) => String(m?.text || m?.body || m?.content || "").trim())
    .filter(Boolean)
    .map((s) => (s.length > 200 ? s.slice(0, 200) + "…" : s));
  return snippets.join("\n---\n");
}

/* ------------------------------------------------------------------ *
 * Parsing: broad alias coverage for dims / qty / material / density /
 *          cavities_count / cavity_dims (incl. round ØD x depth, etc.)
 * ------------------------------------------------------------------ */

// Basic number normalizer that accepts fractions like 3/4
function normalizeNumberToken(tok: string): string {
  const t = tok.trim();
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split("/").map(Number);
    if (b !== 0) return (a / b).toFixed(3).replace(/\.?0+$/, "");
  }
  return t;
}

// Convert tokens like 5 x 4 x 1", or 5x4x1, or 5 × 4 × 1
function normalizeDimsTriple(a: string, b: string, c: string) {
  return `${normalizeNumberToken(a)}x${normalizeNumberToken(b)}x${normalizeNumberToken(c)}`;
}

/** Free text parsing across many aliases */
function extractFreeText(s = ""): Mem {
  const t = (s || "").toLowerCase();

  // ---- dimensions (triple)
  const dimsTriple =
    t.match(/\b(\d+(?:\.\d+)?(?:\/\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\/\d+)?)(?:\s*(?:in|inch|inches|"))?\b/);

  // common aliases that imply dims
  // "size 5x5x1", "overall 10 x 8 x 2", "finished 6x1x.25"
  const dimsAlias =
    t.match(/\b(?:size|overall|finished|dimensions?|dims?)\s*[:\-]?\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\/\d+)?)/);

  // ---- quantity
  const qtyMatch =
    t.match(/\bqty\s*[:=]?\s*(\d{1,7})\b/) ||
    t.match(/\bquantity\s*[:=]?\s*(\d{1,7})\b/) ||
    t.match(/\b(count|pcs?|pieces?|lot|batch)\s*[:=]?\s*(\d{1,7})\b/) ||
    t.match(/\b(\d{1,7})\s*(?:pcs?|pieces?)\b/);

  // ---- material (broad)
  let material: string | undefined;
  if (/\b(xlpe|cross[\s\-]?link(ed)?)\b/.test(t)) material = "XLPE";
  else if (/\bpolyethylene\b|\bpe\b|\bpe\s*foam\b/.test(t)) material = "PE";
  else if (/\bepe\b|expanded\s*pe/.test(t)) material = "EPE";
  else if (/\bpolyurethane\b|\bpu\b|\burethane\b/.test(t)) material = "PU";
  else if (/\bfoam\b/.test(t) && !material) material = "PE"; // default foam → PE fallback

  // ---- density (1.7 lb / 1.7lbs / 1.7# / “1.7 pound” / “about 2 lb”)
  const densMatch =
    t.match(/\b(\d+(?:\.\d+)?)\s*(?:lb|lbs|#|pound|pounds)\b/) ||
    t.match(/\b(?:density|weight|firmness)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs|#|pound|pounds)?\b/);

  // ---- cavities / pockets / cutouts (count)
  const cavCount =
    t.match(/\b(?:cavities|cavity|pockets?|cutouts?|nests?|openings?|recess(?:es)?)\s*[:\-]?\s*(\d{1,5})\b/) ||
    t.match(/\b(\d{1,5})\s*(?:cavities|cavity|pockets?|cutouts?|nests?|openings?|recess(?:es)?)\b/);

  // ---- cavity sizes (triple LxWxD OR round ØD x depth)
  // Examples:
  //   "cavities 1x1x.25"
  //   "each pocket 2 x 3 x .5"
  //   "round Ø3 x .75" or "diameter 3/4 x .75 deep"
  const cavDimsTriple =
    t.match(/\b(?:cavity|cavities|pockets?|cutouts?|holes?|nests?|openings?)\s*(?:size|sizes|dims?|dimensions?)?\s*[:\-]?\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\/\d+)?)/);
  const cavRound =
    t.match(/\b(?:round|dia(?:meter)?|ø)\s*[:\-]?\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*(?:in|inch|inches|")?\s*(?:x|by)\s*(\d+(?:\.\d+)?(?:\/\d+)?)(?:\s*(?:deep|depth))?\b/);

  const out: Mem = {};
  if (dimsTriple) out.dims = normalizeDimsTriple(dimsTriple[1], dimsTriple[2], dimsTriple[3]);
  else if (dimsAlias) out.dims = normalizeDimsTriple(dimsAlias[1], dimsAlias[2], dimsAlias[3]);

  if (qtyMatch) out.qty = Number(qtyMatch[2] || qtyMatch[1]);

  if (material) out.material = material;

  if (densMatch) out.density = `${normalizeNumberToken(densMatch[1])}lb`;

  if (cavCount) out.cavities_count = Number(cavCount[1]);

  if (cavDimsTriple) {
    out.cavity_dims = normalizeDimsTriple(cavDimsTriple[1], cavDimsTriple[2], cavDimsTriple[3]); // LxWxD
  } else if (cavRound) {
    const d = normalizeNumberToken(cavRound[1]);
    const depth = normalizeNumberToken(cavRound[2]);
    out.cavity_dims = `Ø${d}x${depth}`; // ØD x Depth
  }

  return compact(out);
}

/** Labeled line parsing (handles your previous bullet formats) */
function extractLabeledLines(s: string): Mem {
  const out: Mem = {};
  const lines = (s || "").split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.toLowerCase().trim().replace(/^•\s*/, "");

    // dims
    const mDims =
      line.match(/^dimensions?\s*[:\-]\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\/\d+)?)/);
    if (mDims) out.dims = normalizeDimsTriple(mDims[1], mDims[2], mDims[3]);

    // qty
    const mQty = line.match(/^(?:qty|quantity|count|pcs?|pieces?)\s*[:\-]\s*(\d{1,7})\b/);
    if (mQty) out.qty = Number(mQty[1]);

    // material
    if (/^material\s*[:\-]/.test(line)) {
      if (/\bxlpe\b|cross[\s\-]?link/.test(line)) out.material = "XLPE";
      else if (/\bpolyethylene\b|\bpe\b/.test(line)) out.material = "PE";
      else if (/\bepe\b|expanded\s*pe/.test(line)) out.material = "EPE";
      else if (/\bpolyurethane\b|\bpu\b|\burethane\b/.test(line)) out.material = "PU";
    }

    // density
    const mDen = line.match(/^density\s*[:\-]\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs|#|pound|pounds)?\b/);
    if (mDen) out.density = `${normalizeNumberToken(mDen[1])}lb`;

    // cavities count
    const mCavCount = line.match(/^(?:cavities?|pockets?|cutouts?)\s*[:\-]\s*(\d{1,5})\b/);
    if (mCavCount) out.cavities_count = Number(mCavCount[1]);

    // cavity dims (triple or round)
    const mCavTriple =
      line.match(/^(?:cavity|cavities|pockets?|cutouts?|holes?)\s*(?:size|sizes|dims?|dimensions?)?\s*[:\-]\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?(?:\/\d+)?)/);
    if (mCavTriple) out.cavity_dims = normalizeDimsTriple(mCavTriple[1], mCavTriple[2], mCavTriple[3]);

    const mCavRound =
      line.match(/^(?:round|dia(?:meter)?|ø)\s*[:\-]?\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*(?:x|by)\s*(\d+(?:\.\d+)?(?:\/\d+)?)(?:\s*(?:deep|depth))?/);
    if (mCavRound) out.cavity_dims = `Ø${normalizeNumberToken(mCavRound[1])}x${normalizeNumberToken(mCavRound[2])}`;
  }

  return compact(out);
}

/** Subject parsing (customers often stuff details there) */
function extractFromSubject(s = ""): Mem {
  if (!s) return {};
  return extractFreeText(s);
}

/* ------------------------------------------------------------------ *
 * Humanized phrasing & adaptive Q builder
 * ------------------------------------------------------------------ */
const OPENERS = [
  "Thanks for the details—I’ll confirm a couple specs and price this.",
  "Appreciate the info; let me lock in a few details and I’ll quote it.",
  "Sounds good—just want to make sure I have the specs right before pricing.",
  "Thanks! I’ll get you a price as soon as a few specs are confirmed.",
  "Appreciate it—let me confirm a couple items and I’ll dial in the quote.",
];

function pick<T>(arr: T[], seed = Math.random()): T {
  return arr[Math.floor(seed * arr.length)];
}

function shortAck(f: Mem): string | null {
  const bits: string[] = [];
  if (f.dims) bits.push(`dims ${f.dims}`);
  if (typeof f.qty === "number") bits.push(`qty ${f.qty}`);
  if (f.material) bits.push(`${f.material}`);
  if (f.density) bits.push(`${f.density}`);
  if (typeof f.cavities_count === "number") bits.push(`${f.cavities_count} cavities`);
  if (f.cavity_dims) bits.push(`cavity ${f.cavity_dims}`);
  if (!bits.length) return null;
  return `Noted: ${bits.join("; ")}.`;
}

function buildQuestions(f: Mem): string[] {
  const qs: string[] = [];

  if (!f.dims) qs.push("Could you confirm the finished part dimensions (L×W×H, inches)?");

  if (typeof f.qty !== "number") qs.push("How many pieces should I price?");

  if (!f.material) qs.push("Do you prefer PE, EPE, XLPE, or PU foam for this job?");

  if (!f.density && (f.material === "PE" || f.material === "EPE" || f.material === "XLPE")) {
    qs.push("If using PE/EPE/XLPE, what density (e.g., 1.7 lb)?");
  } else if (!f.density && f.material === "PU") {
    qs.push("If PU, what firmness/density would you like?");
  }

  if (typeof f.cavities_count !== "number") {
    qs.push("How many cavities/pockets are needed (if any)?");
  }

  if (typeof f.cavities_count === "number" && !f.cavity_dims) {
    qs.push("What are the cavity sizes (L×W×Depth)? If round, a diameter × depth like Ø3×0.75 works.");
  }

  return qs;
}

function renderEmail(f: Mem): string {
  const opener = pick(OPENERS);
  const ack = shortAck(f);
  const qs = buildQuestions(f);

  const lines: string[] = [opener];
  if (ack) lines.push("", ack);
  if (qs.length) {
    lines.push("");
    qs.forEach((q) => lines.push(`• ${q}`));
  }
  lines.push(
    "",
    "If you have a quick sketch or drawing, you can attach it and I’ll make sure I captured everything."
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Optional 1-sentence opener from the model (kept small & human)
 * ------------------------------------------------------------------ */
async function aiOpener(lastInbound: string, context: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    const prompt = [
      "Write ONE short, natural sentence acknowledging the message and saying you'll price it once specs are confirmed.",
      "Do not include bullets, footers, or extra lines. One sentence only.",
      context ? `Context:\n${context}` : "",
      `Customer message:\n${lastInbound || "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n\n");

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
      j?.choices?.[0]?.text ||
      "";
    const one = String(text || "").trim().replace(/\s+/g, " ");
    if (one) {
      console.log("[aiReply] opener_from_model", one.slice(0, 120));
      return one;
    }
    return null;
  } catch (e: any) {
    console.warn("[aiReply] opener_exception", e?.message || e);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Request parsing (supports raw text or JSON)
 * ------------------------------------------------------------------ */
async function parse(req: NextRequest): Promise<In> {
  try {
    const j = await req.json();
    if (j && typeof j === "object") return j;
  } catch {}
  try {
    const t = await req.text();
    let s = t?.trim() ?? "";
    if (!s) return {};
    if (s.startsWith('"') && s.endsWith('"')) s = JSON.parse(s);
    if (s.startsWith("{") && s.endsWith("}")) return JSON.parse(s);
  } catch {}
  return {};
}

/* ------------------------------------------------------------------ *
 * Route
 * ------------------------------------------------------------------ */
export async function POST(req: NextRequest) {
  try {
    const p = await parse(req);
    const dryRun = !!p.dryRun;
    const lastText = String(p.text || "");
    const subject = String(p.subject || "");
    const threadId = String(p.threadId ?? "").trim();
    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];

    // Parse across text + subject using both strategies
    const f_text = extractFreeText(lastText);
    const f_labels = extractLabeledLines(lastText);
    const f_subject = extractFromSubject(subject);
    const newly = mergeFacts(mergeFacts(f_text, f_labels), f_subject);

    // Load & merge with memory
    let loaded: Mem = {};
    if (threadId) loaded = await loadFacts(threadId);

    const carry = {
      __lastMessageId: loaded?.__lastMessageId || "",
      __lastInternetMessageId: loaded?.__lastInternetMessageId || "",
      __lastGraphMessageId: loaded?.__lastGraphMessageId || "",
    };

    // Merge precedence: loaded < carry < newly (newly wins)
    const merged = mergeFacts({ ...loaded, ...carry }, newly);

    // Debug visibility
    const primaryKeys = ["dims", "qty", "material", "density", "cavities_count", "cavity_dims", "__lastGraphMessageId", "__lastInternetMessageId"];
    console.log("[facts] keys { primary:", Object.fromEntries(primaryKeys.map(k => [k, merged[k]])), " }");

    if (threadId) await saveFacts(threadId, merged);

    // Compose humanized message (optionally swap first sentence for AI opener)
    const context = pickThreadContext(threadMsgs);
    const opener = await aiOpener(lastText, context);
    const emailBody = (() => {
      const base = renderEmail(merged);
      if (!opener) return base;
      // Replace first line with AI opener
      const lines = base.split("\n");
      lines[0] = opener;
      return lines.join("\n");
    })();

    // Recipient guardrails
    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    const toEmail = String(p.toEmail || "").trim().toLowerCase();
    if (!toEmail)
      return err("missing_toEmail", { reason: "Lookup did not produce a recipient; refusing to fall back to mailbox." });

    const ownDomain = mailbox.split("@")[1] || "";
    if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`)))
      return err("bad_toEmail", { toEmail, reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies." });

    // Thread continuity
    const inReplyTo = String(merged?.__lastInternetMessageId || "").trim() || undefined;

    console.info(
      "[orchestrate] msgraph/send { to:",
      toEmail,
      ", dryRun:",
      !!p.dryRun,
      ", threadId:",
      threadId || "<none>",
      ", inReplyTo:",
      inReplyTo ? "<id>" : "none",
      ", alias:",
      subject ? `hsu:${toEmail}::${subject}` : "n/a",
      "}"
    );

    if (dryRun) {
      return ok({
        mode: "dryrun",
        toEmail,
        subject: p.subject || "Quote",
        preview: emailBody.slice(0, 1000),
        facts: merged,
        mem: { threadId: String(threadId), loadedKeys: Object.keys(loaded), mergedKeys: Object.keys(merged) },
        inReplyTo: inReplyTo || null,
        store: LAST_STORE,
      });
    }

    // Send via Graph (live)
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const sendUrl = `${base}/api/msgraph/send`;
    const r = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail,
        subject: p.subject || "Re: your foam quote request",
        text: emailBody,
        inReplyTo: inReplyTo || null,
        dryRun: false,
      }),
      cache: "no-store",
    });
    const sent = await r.json().catch(() => ({}));

    // Persist outbound IDs for next turn
    if (threadId && (r.ok || r.status === 202) && (sent?.messageId || sent?.internetMessageId)) {
      const updated = {
        ...merged,
        __lastGraphMessageId: sent?.messageId || merged?.__lastGraphMessageId || "",
        __lastInternetMessageId: sent?.internetMessageId || merged?.__lastInternetMessageId || "",
      };
      await saveFacts(threadId, updated);
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
    });
  } catch (e: any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
