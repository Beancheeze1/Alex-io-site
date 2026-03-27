// app/api/widget/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

type WidgetFacts = {
  outsideL?: string;
  outsideW?: string;
  outsideH?: string;
  qty?: string;

  shipMode?: "box" | "mailer" | "unsure";

  insertType?: "single" | "set" | "unsure";
  pocketsOn?: "base" | "top" | "both" | "unsure";

  holding?: "pockets" | "loose" | "unsure";
  pocketCount?: "1" | "2" | "3+" | "unsure";

  materialMode?: "recommend" | "known";
  materialText?: string;

  materialId?: number | null;

  packagingSku?: string;

  /** "stock" = customer chose the suggested stock box; "custom" = keep their original size */
  packagingChoice?: "stock" | "custom" | null;

  /** true if the customer wants the box/mailer printed */
  printed?: boolean | null;

  layerCount?: "1" | "2" | "3" | "4";
  layerThicknesses?: string[];

  /** Semicolon-delimited cavity list. Each token: LxWxD (rect) or ØDIAxDEPTH (circle). */
  cavities?: string | null;

  customerName?: string | null;
  customerEmail?: string | null;

  notes?: string;
  createdAtIso?: string;
};

type Incoming = {
  messages?: { role: "bot" | "user"; text: string }[];
  userText?: string;
  facts?: WidgetFacts;
};

type DbMaterial = {
  id: number;
  name: string | null;
  material_family: string | null;
  density_lb_ft3: number | null;
};

function clip(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function hasCoreDims(f: WidgetFacts) {
  return Boolean(f.outsideL && f.outsideW && f.outsideH);
}

function isReady(f: WidgetFacts) {
  const qtyOk = Boolean(f.qty && String(f.qty).trim().length > 0);
  const shipOk = Boolean(f.shipMode && f.shipMode !== ("" as any));
  const insertOk = Boolean(f.insertType && f.insertType !== ("" as any));
  const holdingOk = Boolean(f.holding && f.holding !== ("" as any));
  return hasCoreDims(f) && qtyOk && shipOk && insertOk && holdingOk;
}

function wantsFoamRecommendation(userText: string, facts: WidgetFacts) {
  const t = (userText || "").toLowerCase();

  if (facts.materialMode === "recommend") return true;

  const askPhrases = [
    "recommend",
    "suggest",
    "what foam",
    "which foam",
    "pick foam",
    "choose foam",
    "what material",
    "which material",
    "what type",
    "what should i use",
    "what do i need",
    "need to use",
    "medical device",
    "fragile",
    "delicate",
  ];

  if (askPhrases.some((p) => t.includes(p))) return true;

  const mentionsFoam = t.includes("foam") || t.includes("material");
  const isQuestion = t.includes("?") || t.startsWith("what ") || t.startsWith("which ");
  if (mentionsFoam && isQuestion) return true;

  return false;
}

/**
 * Returns true when the user is *stating* a specific material they already know
 * (density, family name, colour cues) rather than asking for a recommendation.
 * In this case we still want to fetch DB options so we can resolve the materialId.
 */
function wantsMaterialLookup(userText: string, facts: WidgetFacts): boolean {
  // Already have an ID — nothing to look up
  if (facts.materialId != null) return false;

  // Scan both the current user message AND any previously captured materialText
  // so the lookup re-runs on subsequent turns when we have a description but no ID yet.
  const combined = `${facts.materialText ?? ""} ${userText ?? ""}`.toLowerCase();

  // Density patterns: "1.7#", "1.7 lb", "2 lb/ft", "2#", etc.
  const hasDensity = /\d+(\.\d+)?\s*(#|lb|pound|pcf|lb\/ft)/.test(combined);

  // Family keywords stated as a declaration
  const familyKeywords = [
    "polyethylene", " pe ", "pe foam",
    "polyurethane", " pu ", "pu foam", "urethane",
    "expanded polyethylene", " epe ", "epe foam",
    "charcoal", "black", "anti-static", "conductive",
  ];
  const hasFamilyKeyword = familyKeywords.some((kw) => combined.includes(kw.trim()));

  return hasDensity || hasFamilyKeyword;
}

function inferFamilyHint(userText: string, facts: WidgetFacts): string | null {
  const t = `${facts.materialText ?? ""} ${userText ?? ""}`.toLowerCase();

  // IMPORTANT: Keep PE and Expanded PE separate (no merging).
  if (t.includes("expanded polyethylene") || t.includes(" epe") || t.includes("epe "))
    return "Expanded Polyethylene";

  // Colour/grade cues that are unique to PE in packaging context
  if (t.includes("charcoal") || t.includes("black") || t.includes("anti-static") || t.includes("conductive"))
    return "Polyethylene";

  if (t.includes("polyethylene") || / pe[\s,#.]/.test(t) || t.includes("pe foam"))
    return "Polyethylene";

  if (t.includes("polyurethane") || t.includes("urethane") || / pu[\s,#.]/.test(t) || t.includes("pu foam"))
    return "Polyurethane Foam";

  return null;
}

/**
 * Given the user's text, try to extract a density in lb/ft³.
 * Handles: "1.7#", "1.7 lb", "2.0 pcf", "1.7lb/ft3"
 */
function extractDensityHint(userText: string, facts: WidgetFacts): number | null {
  const combined = `${facts.materialText ?? ""} ${userText ?? ""}`;

  const m = combined.match(/(\d+(?:\.\d+)?)\s*(?:#|lb|pcf|pound|lb\/ft)/i);
  if (!m) return null;

  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function getTopMaterialsForWidget(args: {
  familyHint: string | null;
  densityHint: number | null;
  limit: number;
}): Promise<DbMaterial[]> {
  const limit = Math.max(1, Math.min(args.limit || 3, 6));

  // When we have a density hint, bump the matching density to the top of the list.
  // Allow ±0.2 lb/ft³ tolerance so "1.7#" matches 1.7 exactly but also catches nearby grades.
  const densityTolerance = 0.2;

  if (args.familyHint) {
    const rows = await q<DbMaterial>(
      `
      select id, name, material_family, density_lb_ft3
      from materials
      where material_family = $1
      order by
        case
          when $3 is not null and abs(coalesce(density_lb_ft3, -999) - $3) <= $4 then 0
          when $1 = 'Polyurethane Foam' and lower(coalesce(name,'')) like '%1560%' then 1
          when $1 = 'Polyurethane Foam' and lower(coalesce(name,'')) like '%1780%' then 2
          when $1 = 'Polyethylene' and density_lb_ft3 = 1.7 then 1
          when $1 = 'Polyethylene' and density_lb_ft3 = 2.0 then 2
          else 9
        end asc,
        case when density_lb_ft3 is null then 1 else 0 end asc,
        density_lb_ft3 asc,
        id asc
      limit $2
      `,
      [args.familyHint, limit, args.densityHint, densityTolerance],
    );
    return Array.isArray(rows) ? rows : [];
  }

  // No family hint: prioritize house foams across all families
  const rows = await q<DbMaterial>(
    `
    select id, name, material_family, density_lb_ft3
    from materials
    order by
      case when material_family is null then 1 else 0 end asc,
      case
        when $2 is not null and abs(coalesce(density_lb_ft3, -999) - $2) <= $3 then 0
        when material_family = 'Polyurethane Foam' and lower(coalesce(name,'')) like '%1560%' then 1
        when material_family = 'Polyurethane Foam' and lower(coalesce(name,'')) like '%1780%' then 2
        when material_family = 'Polyethylene' and density_lb_ft3 = 1.7 then 1
        when material_family = 'Polyethylene' and density_lb_ft3 = 2.0 then 2
        else 9
      end asc,
      material_family asc,
      case when density_lb_ft3 is null then 1 else 0 end asc,
      density_lb_ft3 asc,
      id asc
    limit $1
    `,
    [limit, args.densityHint, densityTolerance],
  );

  return Array.isArray(rows) ? rows : [];
}

function formatMaterialOption(m: DbMaterial) {
  const parts: string[] = [];
  if (m.name) parts.push(m.name);
  if (m.material_family) parts.push(m.material_family);
  if (m.density_lb_ft3 != null && Number.isFinite(Number(m.density_lb_ft3))) {
    parts.push(`${Number(m.density_lb_ft3).toFixed(1)} lb/ft³`);
  }
  return parts.filter(Boolean).join(" · ");
}

function pickMaterialFromUserText(
  userText: string,
  options: DbMaterial[],
  densityHint: number | null,
): DbMaterial | null {
  const t = (userText || "").trim().toLowerCase();
  if (!t) return null;

  // Numeric shortcut: "1", "2", "3"
  if (t === "1" || t === "2" || t === "3") {
    const idx = Number(t) - 1;
    return options[idx] ?? null;
  }

  // ID shortcut: "id:42" or bare integer
  const idMatch = t.match(/\bid\s*[:#]?\s*(\d+)\b/i) || t.match(/^\s*(\d+)\s*$/);
  if (idMatch) {
    const id = Number(idMatch[1]);
    if (Number.isFinite(id)) return options.find((o) => o.id === id) ?? null;
  }

  // Exact/substring name match
  for (const o of options) {
    const nm = (o.name ?? "").toLowerCase().trim();
    if (nm && (t.includes(nm) || nm.includes(t))) return o;
  }

  // Density match: if we extracted a density hint, pick the option whose
  // density_lb_ft3 is within ±0.15 and is the closest overall.
  if (densityHint != null) {
    const tolerance = 0.15;
    const candidates = options
      .filter((o) => o.density_lb_ft3 != null && Math.abs(Number(o.density_lb_ft3) - densityHint) <= tolerance)
      .sort((a, b) => Math.abs(Number(a.density_lb_ft3) - densityHint) - Math.abs(Number(b.density_lb_ft3) - densityHint));
    if (candidates.length > 0) return candidates[0];
  }

  return null;
}

/* =========================
   Box suggester (prefill)
   ========================= */

type BoxSuggestReq = {
  footprint_length_in: number;
  footprint_width_in: number;
  stack_depth_in: number;
  qty?: number | null;
};

type BoxSuggestBox = {
  sku: string;
  description: string;
  style: "RSC" | "MAILER";
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
  fit_score: number;
  notes?: string;
};

type BoxSuggestResp = {
  ok: boolean;
  bestRsc?: BoxSuggestBox | null;
  bestMailer?: BoxSuggestBox | null;
  error?: string;
};

function toFiniteNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

function appendNote(existing: string | undefined, line: string) {
  const base = (existing ?? "").trim();
  const add = (line ?? "").trim();
  if (!add) return base || undefined;
  if (!base) return add;
  if (base.includes(add)) return base;
  return `${base}\n${add}`;
}

async function maybeSeedPackagingFromBoxesSuggest(args: {
  mergedFacts: WidgetFacts;
}): Promise<{
  /** Only set when customer has already chosen "stock" */
  packagingSku?: string;
  internalHints?: string;
  /** Injected into the AI context so it can present the choice */
  suggestionContext?: string;
  /** Quick replies to surface alongside the AI message */
  suggestionQuickReplies?: string[];
}> {
  const f = args.mergedFacts;

  if (!hasCoreDims(f)) return {};

  // Only run when the customer has indicated a shipping mode — no point suggesting
  // a box when they haven't said whether they want a box or mailer yet.
  if (f.shipMode !== "box" && f.shipMode !== "mailer") return {};

  const L = toFiniteNumber(f.outsideL);
  const W = toFiniteNumber(f.outsideW);
  const H = toFiniteNumber(f.outsideH);
  if (!(L && W && H && L > 0 && W > 0 && H > 0)) return {};

  // If the customer has already made a packaging choice, just honour it
  if (f.packagingChoice === "custom") return {};
  if (f.packagingChoice === "stock" && f.packagingSku) {
    return { packagingSku: f.packagingSku };
  }

  // Don't re-query once we already have a SKU committed
  if (f.packagingSku && String(f.packagingSku).trim().length > 0) return {};

  const url = `https://api.alex-io.com/api/boxes/suggest`;

  const payload: BoxSuggestReq = {
    footprint_length_in: L,
    footprint_width_in: W,
    stack_depth_in: H,
    qty: toFiniteNumber(f.qty) ?? null,
  };

  let resp: BoxSuggestResp | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // 4 s hard cap
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) return {};
    resp = (await r.json().catch(() => null)) as BoxSuggestResp | null;
  } catch {
    return {};
  }

  if (!resp || !resp.ok) return {};

  const bestRsc = resp.bestRsc ?? null;
  const bestMailer = resp.bestMailer ?? null;

  const relevant =
    f.shipMode === "box" ? bestRsc :
    f.shipMode === "mailer" ? bestMailer :
    bestRsc ?? bestMailer;

  if (!relevant?.sku) return {};

  const kind = relevant.style === "MAILER" ? "mailer" : "box";
  const dims = `${relevant.inside_length_in}×${relevant.inside_width_in}×${relevant.inside_height_in} in (inside)`;
  const hintLine = `Suggested stock ${kind}: ${relevant.sku} — ${relevant.description} (${dims})`;

  return {
    internalHints: appendNote((f as any).internalHints, hintLine),
    suggestionContext:
      `SYSTEM NOTE: A stock ${kind} was found for the customer's size: **${relevant.sku}** — ${relevant.description}, inside ${dims}. ` +
      `Their requested outside size was ${f.outsideL}×${f.outsideW}×${f.outsideH} in. ` +
      `Ask the customer whether they want the stock ${kind} (${relevant.sku}) or a custom-sized ${kind} built to their exact dimensions. ` +
      `Set packagingChoice='stock' and packagingSku='${relevant.sku}' if they pick stock, or packagingChoice='custom' if they want custom. ` +
      `Do NOT pre-select for them.`,
    suggestionQuickReplies: [
      `Use stock ${kind}: ${relevant.sku}`,
      `Custom size: ${f.outsideL}×${f.outsideW}×${f.outsideH}`,
    ],
  };
}

/* =========================
   OpenAI call (unchanged)
   ========================= */

async function callOpenAI(params: {
  messages: { role: "bot" | "user"; text: string }[];
  userText: string;
  facts: WidgetFacts;
  materialOptions: DbMaterial[];
  suggestionContext?: string;
}) {
  const apiKey = requireEnv("OPENAI_API_KEY");

  const materialOptionsText =
    params.materialOptions && params.materialOptions.length
      ? params.materialOptions
          .slice(0, 3)
          .map((m, i) => `${i + 1}) ${formatMaterialOption(m)} (id=${m.id})`)
          .join("\n")
      : "(none found)";

  const inputMessages = [
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text:
            "You are Alex-IO’s website chat widget. Your job is to have a natural, confident conversation " +
            "and extract quoting facts for a foam packaging insert quote.\n\n" +
            "IMPORTANT RULES:\n" +
            "- Be chatty like a helpful expert, not a form.\n" +
            "- Ask ONE question at a time.\n" +
            "- Never invent facts. If unsure, ask.\n" +
            "- Keep answers short (1–3 short paragraphs).\n" +
            "- When user gives multiple facts at once, acknowledge + move on.\n" +
            "- Update a structured facts object.\n" +
            "- Propose up to 6 quick replies when useful.\n\n" +
            "Fields you care about:\n" +
            "- outside size L×W×H (in)\n" +
            "- qty\n" +
            "- customerName: customer's full name — ask for this early (after dims + qty)\n" +
            "- customerEmail: customer's email address — ask right after name\n" +
            "- shipping: box vs mailer vs unsure (fit matters)\n" +
            "- printed: does the customer want the box/mailer printed? (true/false) — ask this when shipMode is box or mailer\n" +
            "- packagingChoice: ONLY set this when a SYSTEM NOTE below presents a stock box/mailer option AND the customer has responded.\n" +
            "   - 'stock' if they choose the suggested stock size (also set packagingSku to the SKU shown)\n" +
            "   - 'custom' if they want a custom-built box to their exact dimensions\n" +
            "   - Leave null until they explicitly choose — never pre-select for them.\n" +
            "- insert type: single vs set (base + top pad/lid)\n" +
            "- holding: cut-out pockets vs loose vs unsure\n" +
            "- pocketsOn: base/top/both if set\n" +
            "- pocketCount: 1/2/3+/unsure if pockets\n" +
            "- material:\n" +
            "   - If user knows it: materialMode='known' + materialText\n" +
            "   - If user wants us to pick: materialMode='recommend'\n" +
            "   - If user selects from DB options below: set materialMode='known', materialText, AND materialId\n" +
            "- layers: layerCount (1–4) and layerThicknesses array\n" +
            "  Convention: Layer 1 = base/body, higher layers stack upward (top pad/lid is last layer).\n" +
            "  IMPORTANT: Always populate layerThicknesses when the user mentions any thickness.\n" +
            "  Examples:\n" +
            "    - '2 inch insert' → layerCount='1', layerThicknesses=['2']\n" +
            "    - '2 inch bottom, 0.5 inch top pad' → layerCount='2', layerThicknesses=['2','0.5']\n" +
            "    - 'set with base and lid' (no thickness given) → layerCount='2', layerThicknesses=['1','1'] as default guess\n" +
            "  If the user mentions a top pad thickness, ALWAYS put it as the last element of layerThicknesses.\n" +
            "- cavities: ALL pocket sizes as a semicolon-delimited string.\n" +
            "   - Rectangular pocket: LxWxD  (e.g. '3x2x1')\n" +
            "   - Round/circular pocket: ØDIAxDEPTH  (e.g. 'Ø3x1' for a 3\" diameter, 1\" deep hole)\n" +
            "   - NEVER convert a circle to a rect. If user says 'diameter', 'round', or 'circular', use the Ø prefix.\n" +
            "   - Multiple pockets: join with semicolons  (e.g. '3x2x1;Ø2x1.5')\n" +
            "- notes\n\n" +
            'When shipping is box or mailer, mention briefly we typically undersize foam L/W by 0.125" for drop-in fit.\n' +
            "When you have enough info, done=true and invite them to open layout & pricing.\n\n" +
            "DB MATERIAL OPTIONS (use these when the user asks you to recommend foam):\n" +
            materialOptionsText +
            "\n\n" +
            "When recommending foam:\n" +
            "- Recommend ONE best choice and optionally mention 1 alternative.\n" +
            "- Then ask: 'Pick 1/2/3' (or type the material name).\n" +
            "- Do NOT invent material IDs; only use ids shown above.\n" +
            "- Do NOT recommend a generic foam description if DB options are available; use the options list.",
        },
      ],
    },
    {
      role: "developer",
      content: [
        {
          type: "input_text",
          text:
            "Current known facts JSON:\n" +
            clip(JSON.stringify(params.facts ?? {}), 2000) +
            "\n\nConversation so far (most recent last):\n" +
            clip(
              (params.messages ?? [])
                .slice(-12)
                .map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.text}`)
                .join("\n"),
              4000,
            ) +
            (params.suggestionContext ? `\n\n${params.suggestionContext}` : "") +
            "\n\nNewest user message:\n" +
            clip(params.userText, 800),
        },
      ],
    },
  ];

  const body = {
    model: "gpt-4o-2024-08-06",
    input: inputMessages,
    text: {
      format: {
        type: "json_schema",
        name: "widget_chat_schema",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["assistantMessage", "facts", "done", "quickReplies"],
          properties: {
            assistantMessage: { type: "string" },
            done: { type: "boolean" },
            quickReplies: { type: "array", items: { type: "string" }, maxItems: 6 },
            facts: {
              type: "object",
              additionalProperties: false,
              required: [
                "outsideL",
                "outsideW",
                "outsideH",
                "qty",
                "shipMode",
                "insertType",
                "pocketsOn",
                "holding",
                "pocketCount",
                "materialMode",
                "materialText",
                "materialId",
                "packagingSku",
                "packagingChoice",
                "printed",
                "layerCount",
                "layerThicknesses",
                "cavities",
                "customerName",
                "customerEmail",
                "notes",
                "createdAtIso",
              ],
              properties: {
                outsideL: { type: ["string", "null"] },
                outsideW: { type: ["string", "null"] },
                outsideH: { type: ["string", "null"] },
                qty: { type: ["string", "null"] },
                shipMode: { anyOf: [{ type: "string", enum: ["box", "mailer", "unsure"] }, { type: "null" }] },
                insertType: { anyOf: [{ type: "string", enum: ["single", "set", "unsure"] }, { type: "null" }] },
                pocketsOn: { anyOf: [{ type: "string", enum: ["base", "top", "both", "unsure"] }, { type: "null" }] },
                holding: { anyOf: [{ type: "string", enum: ["pockets", "loose", "unsure"] }, { type: "null" }] },
                pocketCount: { anyOf: [{ type: "string", enum: ["1", "2", "3+", "unsure"] }, { type: "null" }] },
                materialMode: { anyOf: [{ type: "string", enum: ["recommend", "known"] }, { type: "null" }] },
                materialText: { type: ["string", "null"] },
                materialId: { type: ["number", "null"] },
                packagingSku: { type: ["string", "null"] },
                packagingChoice: { anyOf: [{ type: "string", enum: ["stock", "custom"] }, { type: "null" }] },
                printed: { anyOf: [{ type: "boolean" }, { type: "null" }] },
                layerCount: { anyOf: [{ type: "string", enum: ["1", "2", "3", "4"] }, { type: "null" }] },
                layerThicknesses: { anyOf: [{ type: "array", items: { type: "string" }, maxItems: 4 }, { type: "null" }] },
                cavities: { type: ["string", "null"] },
                customerName: { type: ["string", "null"] },
                customerEmail: { type: ["string", "null"] },
                notes: { type: ["string", "null"] },
                createdAtIso: { type: ["string", "null"] },
              },
            },
          },
        },
      },
    },
  };

  const openaiController = new AbortController();
  const openaiTimeout = setTimeout(() => openaiController.abort(), 25000); // 25 s hard cap
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: openaiController.signal,
    });
  } finally {
    clearTimeout(openaiTimeout);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`openai_http_${res.status}_${txt.slice(0, 220)}`);
  }

  const json = (await res.json()) as any;

  const outputObj = json?.output_json && typeof json.output_json === "object" ? json.output_json : null;
  if (outputObj) return outputObj;

  const outputText: string =
    typeof json?.output_text === "string"
      ? json.output_text
      : (json?.output?.[0]?.content?.find?.((c: any) => c?.type === "output_text")?.text ?? "");

  return JSON.parse(String(outputText || "").trim());
}

function normalizeBrainObj(obj: any) {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.assistantMessage !== "string") return null;
  if (typeof obj.done !== "boolean") return null;
  if (!obj.facts || typeof obj.facts !== "object") obj.facts = {};
  if (!Array.isArray(obj.quickReplies)) obj.quickReplies = [];
  return obj as { assistantMessage: string; facts: Partial<WidgetFacts>; done: boolean; quickReplies: string[] };
}

function normalizeLooseName(raw: string): string | null {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.,!?]+$/g, "")
    .trim();

  if (!cleaned) return null;

  const parts = cleaned
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) return null;

  const looksNamey = parts.every((p) => /^[A-Za-z][A-Za-z'’-]*$/.test(p));
  if (!looksNamey) return null;

  return parts.join(" ");
}

function extractSimpleFacts(userText: string, facts: WidgetFacts): Partial<WidgetFacts> {
  const text = String(userText || "").trim();
  const next: Partial<WidgetFacts> = {};

  const dimMatch = text.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (dimMatch) {
    next.outsideL = dimMatch[1];
    next.outsideW = dimMatch[2];
    next.outsideH = dimMatch[3];
  }

  const qtyMatch =
    text.match(/\bqty\b\s*[:#-]?\s*(\d+)\b/i) ||
    text.match(/\bquantity\b\s*[:#-]?\s*(\d+)\b/i);
  if (qtyMatch) {
    next.qty = qtyMatch[1];
  } else if (!facts.qty && /^\d+$/.test(text)) {
    next.qty = text;
  }

  if (/\bmailer\b/i.test(text)) next.shipMode = "mailer";
  else if (/\bbox\b/i.test(text)) next.shipMode = "box";

  if (/\bprinted\b/i.test(text)) next.printed = true;
  if (/\bnot printed\b/i.test(text) || /\bunprinted\b/i.test(text)) next.printed = false;

  if (
    /\bset\b/i.test(text) ||
    /\btop pad\b/i.test(text) ||
    /\blid\b/i.test(text) ||
    /\b2 pieces?\b/i.test(text) ||
    /\bbase\b/i.test(text)
  ) {
    next.insertType = "set";
  } else if (/\bsingle\b/i.test(text) || /\b1 piece\b/i.test(text)) {
    next.insertType = "single";
  }

  if (/\bpockets?\b/i.test(text) || /\bcut-?out\b/i.test(text) || /\bcavit(?:y|ies)\b/i.test(text)) {
    next.holding = "pockets";
  } else if (/\bloose\b/i.test(text) || /\bno pockets?\b/i.test(text)) {
    next.holding = "loose";
  }

  const nameMatch =
    text.match(/\bmy name is\s+(.+)$/i) ||
    text.match(/\bit'?s\s+(.+)$/i) ||
    text.match(/\bi am\s+(.+)$/i) ||
    text.match(/\bthis is\s+(.+)$/i);

  if (!facts.customerName) {
    const explicitName = normalizeLooseName(nameMatch?.[1] ?? "");
    if (explicitName) {
      next.customerName = explicitName;
    } else {
      const looseName = normalizeLooseName(text);
      if (
        looseName &&
        !/\bqty\b/i.test(text) &&
        !/\bquantity\b/i.test(text) &&
        !/\bbox\b/i.test(text) &&
        !/\bmailer\b/i.test(text) &&
        !/[x×]/i.test(text)
      ) {
        next.customerName = looseName;
      }
    }
  }

  if (!facts.materialText && wantsMaterialLookup(text, facts)) {
    next.materialMode = "known";
    next.materialText = text;
  }

  return next;
}

function nextQuestionFromFacts(f: WidgetFacts): {
  assistantMessage: string;
  quickReplies: string[];
  done: boolean;
} {
  if (!hasCoreDims(f)) {
    return {
      assistantMessage: "Got it — what's the outside foam size (LxWxH, inches)?",
      quickReplies: ["18x12x3", "12x10x2", "Not sure yet"],
      done: false,
    };
  }

  if (!f.qty || !String(f.qty).trim()) {
    return {
      assistantMessage: "Got it — what's the quantity?",
      quickReplies: ["Qty 25", "Qty 100", "Qty 250"],
      done: false,
    };
  }

  if (!f.shipMode) {
    return {
      assistantMessage: "Do you want this in a box or a mailer?",
      quickReplies: ["Shipping: box", "Shipping: mailer", "Not sure yet"],
      done: false,
    };
  }

  if (f.printed == null && (f.shipMode === "box" || f.shipMode === "mailer")) {
    return {
      assistantMessage: `Do you want the ${f.shipMode} printed?`,
      quickReplies: ["Printed", "Not printed"],
      done: false,
    };
  }

  if (!f.insertType) {
    return {
      assistantMessage: "Is this a single insert or a set with a base and top pad/lid?",
      quickReplies: ["Single insert", "Set insert", "Not sure yet"],
      done: false,
    };
  }

  if (!f.holding) {
    return {
      assistantMessage: "Will the product sit loose, or do you need cut-out pockets?",
      quickReplies: ["Loose / no pockets", "Cut-out pockets", "Not sure yet"],
      done: false,
    };
  }

  if (!f.customerName || !String(f.customerName).trim()) {
    return {
      assistantMessage: "Great, we're moving along. What's your full name?",
      quickReplies: [],
      done: false,
    };
  }

  if (!f.customerEmail || !String(f.customerEmail).trim()) {
    return {
      assistantMessage: "Perfect. What's the best email for the quote?",
      quickReplies: [],
      done: false,
    };
  }

  return {
    assistantMessage: "Perfect — I've got enough to open layout and pricing.",
    quickReplies: [],
    done: true,
  };
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as Incoming;

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const userText = String(payload.userText ?? "").trim();
    const facts = (payload.facts ?? {}) as WidgetFacts;

    const simpleFacts = extractSimpleFacts(userText, facts);
    const seededFacts: WidgetFacts = { ...facts, ...simpleFacts };

    if (!userText) {
      return NextResponse.json(
        {
          assistantMessage: "Tell me what you know so far — even messy is fine.",
          facts: {},
          done: false,
          quickReplies: ["18x12x3", "Qty 250", "Shipping: box", "Shipping: mailer"],
        },
        { status: 200 },
      );
    }

    const densityHint = extractDensityHint(userText, seededFacts);
    let materialOptions: DbMaterial[] = [];
    const shouldOfferFoam = wantsFoamRecommendation(userText, seededFacts);
    const shouldLookupMaterial = !shouldOfferFoam && wantsMaterialLookup(userText, seededFacts);

    if (shouldOfferFoam || shouldLookupMaterial) {
      const familyHint = inferFamilyHint(userText, seededFacts);
      materialOptions = await getTopMaterialsForWidget({ familyHint, densityHint, limit: shouldLookupMaterial ? 6 : 3 });
    }

    const pickedFromText = materialOptions.length ? pickMaterialFromUserText(userText, materialOptions, densityHint) : null;

    // Run box suggester BEFORE AI call so we can inject the stock suggestion as context.
    const pack = await maybeSeedPackagingFromBoxesSuggest({ mergedFacts: seededFacts });

    const rawObj = await callOpenAI({
      messages,
      userText,
      facts: seededFacts,
      materialOptions,
      suggestionContext: pack.suggestionContext,
    });
    const parsed = normalizeBrainObj(rawObj);

   if (!parsed) {
  return NextResponse.json(
    {
      assistantMessage: "Got it â€” letâ€™s fill in a couple details. Whatâ€™s the quantity?",
          facts: {},
          done: false,
          quickReplies: ["18x12x3", "Qty 250", "Not sure yet"],
        },
        { status: 200 },
      );
    }

    const nextFacts: Partial<WidgetFacts> = { ...(parsed.facts ?? {}) };

    if (pickedFromText) {
      nextFacts.materialMode = "known";
      nextFacts.materialId = pickedFromText.id;
      nextFacts.materialText = pickedFromText.name ?? formatMaterialOption(pickedFromText);
    } else {
      const mid = (nextFacts as any).materialId;
      if (mid != null && Number.isFinite(Number(mid)) && materialOptions.length) {
        const found = materialOptions.find((m) => m.id === Number(mid));
        if (found) {
          nextFacts.materialMode = "known";
          if (!nextFacts.materialText) nextFacts.materialText = found.name ?? formatMaterialOption(found);
        }
      } else if (shouldLookupMaterial && materialOptions.length > 0 && nextFacts.materialId == null) {
        // Lookup ran but neither client-text match nor AI-set ID succeeded.
        // Auto-select the top result (already sorted by density match) so the ID
        // always gets committed when we have a confident family + density signal.
        const best = materialOptions[0];
        nextFacts.materialMode = "known";
        nextFacts.materialId = best.id;
        nextFacts.materialText = best.name ?? formatMaterialOption(best);
      }
    }

    // COMPREHENSIVE FACT PRESERVATION
    // The AI schema requires every field in every response, so GPT emits null (or
    // empty arrays) for fields that weren't the topic of this turn. Prevent any
    // previously-resolved value from being overwritten by a null/empty from the AI.
    // This is the core reason facts disappear from the widget summary between turns.
    const isBlank = (v: any) =>
      v == null || (Array.isArray(v) && v.length === 0) || v === "";

    const preserveKeys: (keyof WidgetFacts)[] = [
      "outsideL", "outsideW", "outsideH", "qty",
      "shipMode", "insertType", "pocketsOn", "holding", "pocketCount",
      "materialMode", "materialText", "materialId",
      "packagingSku", "packagingChoice", "printed",
      "layerCount", "layerThicknesses", "cavities",
      "customerName", "customerEmail", "notes",
    ];
    for (const key of preserveKeys) {
      if (isBlank(nextFacts[key]) && !isBlank(facts[key])) {
        (nextFacts as any)[key] = facts[key];
      }
    }

    // RECOMMEND MODE AUTO-COMMIT:
    // When the AI finishes (done=true) in "recommend" mode but never explicitly set
    // materialId (e.g. user said "you pick" and then "sounds good"), auto-commit
    // the top DB material option so materialId is always populated before the editor
    // opens. Without this, ensurePrimaryQuoteItem bails with a null materialId and
    // Apply throws a 500.
    if (
      parsed.done &&
      nextFacts.materialMode === "recommend" &&
      isBlank(nextFacts.materialId) &&
      materialOptions.length > 0
    ) {
      const best = materialOptions[0];
      nextFacts.materialId = best.id;
      nextFacts.materialMode = "known";
      nextFacts.materialText = best.name ?? formatMaterialOption(best);
    }

    const mergedFacts: WidgetFacts = { ...seededFacts, ...nextFacts };

    // Layer safety net: if insertType is "set" (base + top pad) but layerThicknesses
    // is still blank after the preserve loop, default to 2 layers. This ensures the
    // form always receives a meaningful layer count even when the AI didn't explicitly
    // populate the array (e.g. the customer only said "I need a set insert").
    if (
      mergedFacts.insertType === "set" &&
      isBlank(nextFacts.layerThicknesses) &&
      isBlank(mergedFacts.layerThicknesses)
    ) {
      nextFacts.layerCount = "2";
      nextFacts.layerThicknesses = ["1", "1"]; // form can adjust; at least opens as 2-layer
      mergedFacts.layerCount = "2";
      mergedFacts.layerThicknesses = ["1", "1"];
    }

    // Only commit packagingSku once the customer explicitly chooses "stock".
    if (pack.packagingSku && nextFacts.packagingChoice === "stock") {
      nextFacts.packagingSku = pack.packagingSku;
      mergedFacts.packagingSku = pack.packagingSku;
    }

    const assistantMessage = parsed.assistantMessage;

    // AI quick replies take priority; pad with suggestion choices if fewer than 2.
    const aiReplies = (parsed.quickReplies ?? []).slice(0, 6);
    const finalReplies =
      aiReplies.length >= 2
        ? aiReplies
        : [...aiReplies, ...(pack.suggestionQuickReplies ?? [])].slice(0, 6);

    const done = parsed.done && isReady(mergedFacts);

// If AI responded normally, NEVER treat "not ready" as an error

    return NextResponse.json(
      {
        assistantMessage,
        facts: mergedFacts,
        done,
        quickReplies: finalReplies,
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error("widget_chat_route_error", String(e?.message ?? e));
    const payload = await req.clone().json().catch(() => null as Incoming | null);
    const userText = String(payload?.userText ?? "").trim();
    const priorFacts = ((payload?.facts ?? {}) as WidgetFacts) || {};
    const simpleFacts = extractSimpleFacts(userText, priorFacts);
    const fallbackFacts: WidgetFacts = { ...priorFacts, ...simpleFacts };

    const next = nextQuestionFromFacts(fallbackFacts);
    return NextResponse.json(
      {
        assistantMessage: next.assistantMessage,
        facts: fallbackFacts,
        done: next.done,
        quickReplies: next.quickReplies,
      },
      { status: 200 },
    );
  }
}

