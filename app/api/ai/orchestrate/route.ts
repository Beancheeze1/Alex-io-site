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

/* ----------------- Parsing helpers (expanded) ----------------- */
function extractLabeledLines(s: string) {
  const out: Mem = {};
  const lines = (s || "").split(/\r?\n/);
  for (const line of lines) {
    const t = line.toLowerCase().trim().replace(/^•\s*/, "");
    const mDims = t.match(/^dimensions?\s*[:\-]\s*([0-9.]+\s*[x×]\s*[0-9.]+\s*[x×]\s*[0-9.]+)/);
    if (mDims) out.dims = mDims[1].replace(/\s+/g, "").replace(/×/g, "x");
    const mQty = t.match(/^qty(?:uantity)?\s*[:\-]\s*(\d{1,6})\b/);
    if (mQty) out.qty = Number(mQty[1]);
    if (/^material\s*[:\-]/.test(t)) {
      if (/\bpe\b|\bpolyethylene\b/.test(t)) out.material = "PE";
      else if (/\bepe\b|expanded\s*pe/.test(t)) out.material = "EPE";
      else if (/\bpu\b|\bpolyurethane\b/.test(t)) out.material = "PU";
    }
    const mDen = t.match(/^density\s*[:\-]\s*(\d+(?:\.\d+)?)\s*(?:lb|lbs|#)\b/);
    if (mDen) out.density = `${mDen[1]}lb`;
  }
  return out;
}

function extractFreeText(s = ""): Mem {
  const t = (s || "").toLowerCase();
  const dimsMatch = t.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/);
  const qtyMatch =
    t.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/) ||
    t.match(/\bquantity\s*[:=]?\s*(\d{1,6})\b/) ||
    t.match(/\b(\d{1,6})\s*(pcs?|pieces?)\b/);
  const densMatch = t.match(/\b(\d+(?:\.\d+)?)\s*(?:lb|lbs|#)\b/);

  let material: string | undefined;
  if (/\bpolyethylene\b|\bpe\b/.test(t)) material = "PE";
  else if (/\bexpanded\s*pe\b|\bepe\b/.test(t)) material = "EPE";
  else if (/\bpolyurethane\b|\bpu\b/.test(t)) material = "PU";

  return compact({
    dims:    dimsMatch ? `${dimsMatch[1]}x${dimsMatch[2]}x${dimsMatch[3]}` : undefined,
    density: densMatch ? `${densMatch[1]}lb` : undefined,
    qty:     qtyMatch ? Number(qtyMatch[1]) : undefined,
    material,
  });
}
function extractFromSubject(s = ""): Mem { return s ? extractFreeText(s) : {}; }

function extractFromThreadMsgs(threadMsgs: any[] = []): Mem {
  let out: Mem = {};
  const take = threadMsgs.slice(-5);
  for (const m of take) {
    const text = String(m?.text || m?.body || m?.content || "").trim();
    if (!text) continue;
    out = mergeFacts(out, extractLabeledLines(text));
    out = mergeFacts(out, extractFreeText(text));
  }
  return out;
}

function renderBullets(f: Mem): string {
  const v = (x: any) => (x === undefined || x === null || String(x).trim() === "" ? "—" : String(x));
  return [
    `• Dimensions: ${v(f.dims)}`,
    `• Quantity: ${v(f.qty)}`,
    `• Material: ${v(f.material)}`,
    `• Density: ${v(f.density)}`,
  ].join("\n");
}

// --- NEW: a stable alias key to survive new HubSpot threadIds ---
function normalizeSubject(s: string) {
  let x = (s || "").toLowerCase().trim();
  x = x.replace(/^(re|fw|fwd)\s*:\s*/g, ""); // strip common prefixes
  x = x.replace(/\s+/g, " ").trim();
  return x;
}
function makeAliasKey(email: string, subject: string) {
  const e = (email || "").toLowerCase().trim();
  const s = normalizeSubject(subject || "");
  return e && s ? `hsu:${e}::${s}` : "";
}

// Tiny opener
async function aiOpener(lastInbound: string, context: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    const prompt = [
      "Write ONE short, friendly sentence acknowledging the message and saying you'll price it once specs are confirmed.",
      "Do not include bullets, footers, or extra lines. One sentence only.",
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
      j?.choices?.[0]?.text ||
      "";
    const one = String(text || "").trim().replace(/\s+/g, " ");
    if (one) {
      console.log("[aiReply] opener_from_model", one.slice(0, 120));
      return one;
    }
    return null;
  } catch (e:any) {
    console.warn("[aiReply] opener_exception", e?.message || e);
    return null;
  }
}

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
    const threadId = String(p.threadId ?? "").trim();
    const toEmail  = String(p.toEmail || "").trim().toLowerCase();
    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];

    // Parse current turn + subject + recent msgs
    const fromTextFree    = extractFreeText(lastText);
    const fromTextLabels  = extractLabeledLines(lastText);
    const fromSubject     = extractFromSubject(subject);
    const fromThreadMsgs  = extractFromThreadMsgs(threadMsgs);
    const newly           = mergeFacts(mergeFacts(mergeFacts(fromTextFree, fromTextLabels), fromSubject), fromThreadMsgs);

    // Keys
    const primaryKey = threadId ? String(threadId) : "";
    const hsKey = primaryKey ? (primaryKey.startsWith("hs:") ? primaryKey : `hs:${primaryKey}`) : "";
    const aliasKey = makeAliasKey(toEmail, subject);

    // Load both
    let memPrimary: Mem = {};
    let memAlias: Mem = {};
    if (hsKey) memPrimary = await loadFacts(hsKey).catch(() => ({}));
    if (aliasKey) memAlias = await loadFacts(aliasKey).catch(() => ({}));

    // Carry special ids from either store
    const carry = {
      __lastMessageId: memPrimary.__lastMessageId || memAlias.__lastMessageId || "",
      __lastInternetMessageId: memPrimary.__lastInternetMessageId || memAlias.__lastInternetMessageId || "",
    };

    // Merge precedence: previous (primary ⊕ alias) ⊕ newly
    const prev = mergeFacts(memAlias, memPrimary);
    const merged = mergeFacts({ ...prev, ...carry }, newly);

    // Debug
    console.log("[facts] keys { primary:", hsKey || "(none)", ", alias:", aliasKey || "(none)", "}");
    console.log("[facts] loaded_primary_keys:", Object.keys(memPrimary || {}).join(",") || "(none)");
    console.log("[facts] loaded_alias_keys:", Object.keys(memAlias || {}).join(",") || "(none)");
    console.log("[facts] newly:", newly);
    console.log("[facts] merged:", merged);

    // Save back to both keys so next turn hits either
    if (hsKey) await saveFacts(hsKey, merged).catch(() => {});
    if (aliasKey) await saveFacts(aliasKey, merged).catch(() => {});

    // Compose reply
    const context = pickThreadContext(threadMsgs);
    const opener = await aiOpener(lastText, context);
    const bullets = renderBullets(merged);
    const closer = "Please confirm any blanks (or attach a quick sketch) and I’ll finalize pricing.";
    const body = [opener || "Thanks for the details so far.", "", bullets, "", closer].join("\n");

    // Recipient guardrails
    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    if (!toEmail) return err("missing_toEmail", { reason: "Lookup did not produce a recipient; refusing to fall back to mailbox." });
    const ownDomain = mailbox.split("@")[1] || "";
    if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`))) {
      return err("bad_toEmail", { toEmail, reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies." });
    }

    // Thread continuity
    const inReplyTo = String(merged?.__lastInternetMessageId || "").trim() || undefined;

    console.info("[orchestrate] msgraph/send { to:", toEmail, ", dryRun:", !!p.dryRun, ", threadId:", hsKey || "<none>", ", alias:", aliasKey || "<none>", ", inReplyTo:", inReplyTo ? "<id>" : "none", "}");

    if (dryRun) {
      return ok({
        mode: "dryrun",
        toEmail,
        subject: p.subject || "Quote",
        preview: body.slice(0, 800),
        facts: merged,
        mem: {
          threadKey: hsKey || null,
          aliasKey: aliasKey || null,
          primaryLoaded: Object.keys(memPrimary || {}),
          aliasLoaded: Object.keys(memAlias || {}),
          mergedKeys: Object.keys(merged || {}),
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

    // Persist outbound IDs to both keys (so either path has the latest)
    if ((r.ok || r.status === 202) && (sent?.messageId || sent?.internetMessageId)) {
      const update = {
        ...merged,
        __lastGraphMessageId: sent?.messageId || merged?.__lastGraphMessageId || "",
        __lastInternetMessageId: sent?.internetMessageId || merged?.__lastInternetMessageId || "",
      };
      if (hsKey) await saveFacts(hsKey, update).catch(() => {});
      if (aliasKey) await saveFacts(aliasKey, update).catch(() => {});
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
      keys: { threadKey: hsKey || null, aliasKey: aliasKey || null },
    });
  } catch (e:any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
