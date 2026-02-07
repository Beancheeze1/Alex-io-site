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

  layerCount?: "1" | "2" | "3" | "4";
  layerThicknesses?: string[];

  firstCavity?: string;

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

function inferFamilyHint(userText: string, facts: WidgetFacts): string | null {
  const t = `${facts.materialText ?? ""} ${userText ?? ""}`.toLowerCase();

  // IMPORTANT: Keep PE and Expanded PE separate (no merging).
  if (t.includes("expanded polyethylene") || t.includes(" epe") || t.includes("epe "))
    return "Expanded Polyethylene";

  if (t.includes("polyethylene") || t.includes(" pe") || t.includes("pe "))
    return "Polyethylene";

  if (t.includes("polyurethane") || t.includes("urethane") || t.includes("pu "))
    return "Polyurethane Foam";

  return null;
}

async function getTopMaterialsForWidget(args: {
  familyHint: string | null;
  limit: number;
}): Promise<DbMaterial[]> {
  const limit = Math.max(1, Math.min(args.limit || 3, 6));

  // Preference ordering:
  // - Polyurethane Foam: prefer 1560, then 1780 (by name contains)
  // - Polyethylene: prefer density 1.7, then 2.0 (by density_lb_ft3)
  if (args.familyHint) {
    const rows = await q<DbMaterial>(
      `
      select id, name, material_family, density_lb_ft3
      from materials
      where material_family = $1
      order by
        case
          when $1 = 'Polyurethane Foam' and lower(coalesce(name,'')) like '%1560%' then 0
          when $1 = 'Polyurethane Foam' and lower(coalesce(name,'')) like '%1780%' then 1
          when $1 = 'Polyethylene' and density_lb_ft3 = 1.7 then 0
          when $1 = 'Polyethylene' and density_lb_ft3 = 2.0 then 1
          else 9
        end asc,
        case when density_lb_ft3 is null then 1 else 0 end asc,
        density_lb_ft3 asc,
        id asc
      limit $2
      `,
      [args.familyHint, limit],
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
        -- Prioritize house foams across all families
        when material_family = 'Polyurethane Foam' and lower(coalesce(name,'')) like '%1560%' then 0
        when material_family = 'Polyurethane Foam' and lower(coalesce(name,'')) like '%1780%' then 1
        when material_family = 'Polyethylene' and density_lb_ft3 = 1.7 then 0
        when material_family = 'Polyethylene' and density_lb_ft3 = 2.0 then 1
        else 9
      end asc,
      material_family asc,
      case when density_lb_ft3 is null then 1 else 0 end asc,
      density_lb_ft3 asc,
      id asc
    limit $1
    `,
    [limit],
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

function pickMaterialFromUserText(userText: string, options: DbMaterial[]): DbMaterial | null {
  const t = (userText || "").trim().toLowerCase();
  if (!t) return null;

  if (t === "1" || t === "2" || t === "3") {
    const idx = Number(t) - 1;
    return options[idx] ?? null;
  }

  const idMatch = t.match(/\bid\s*[:#]?\s*(\d+)\b/i) || t.match(/^\s*(\d+)\s*$/);
  if (idMatch) {
    const id = Number(idMatch[1]);
    if (Number.isFinite(id)) {
      return options.find((o) => o.id === id) ?? null;
    }
  }

  for (const o of options) {
    const nm = (o.name ?? "").toLowerCase().trim();
    if (nm && (t.includes(nm) || nm.includes(t))) return o;
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
  packagingSku?: string;
  notes?: string;
  messageAddon?: string;
}> {
  const f = args.mergedFacts;

  if (!hasCoreDims(f)) return {};

  const L = toFiniteNumber(f.outsideL);
  const W = toFiniteNumber(f.outsideW);
  const H = toFiniteNumber(f.outsideH);
  if (!(L && W && H && L > 0 && W > 0 && H > 0)) return {};

  if (f.packagingSku && String(f.packagingSku).trim().length > 0) return {};

  // 🔒 FIX: use the known-good API domain (avoid proxy/origin ambiguity)
  const url = `https://api.alex-io.com/api/boxes/suggest`;

  const payload: BoxSuggestReq = {
    footprint_length_in: L,
    footprint_width_in: W,
    stack_depth_in: H,
    qty: toFiniteNumber(f.qty) ?? null,
  };

  let resp: BoxSuggestResp | null = null;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!r.ok) return {};
    resp = (await r.json().catch(() => null)) as BoxSuggestResp | null;
  } catch {
    return {};
  }

  if (!resp || !resp.ok) return {};

  const bestRsc = resp.bestRsc ?? null;
  const bestMailer = resp.bestMailer ?? null;

  if (f.shipMode === "box" && bestRsc?.sku) {
    const noteLine = `Suggested box (stock): ${bestRsc.sku} — ${bestRsc.description} (inside ${bestRsc.inside_length_in}×${bestRsc.inside_width_in}×${bestRsc.inside_height_in})`;
    return {
      packagingSku: bestRsc.sku,
      notes: appendNote(f.notes, noteLine),
      messageAddon: `Stock box suggestion: **${bestRsc.sku}** (${bestRsc.inside_length_in}×${bestRsc.inside_width_in}×${bestRsc.inside_height_in} inside). You can change it in the editor.`,
    };
  }

  if (f.shipMode === "mailer" && bestMailer?.sku) {
    const noteLine = `Suggested mailer (stock): ${bestMailer.sku} — ${bestMailer.description} (inside ${bestMailer.inside_length_in}×${bestMailer.inside_width_in}×${bestMailer.inside_height_in})`;
    return {
      packagingSku: bestMailer.sku,
      notes: appendNote(f.notes, noteLine),
      messageAddon: `Stock mailer suggestion: **${bestMailer.sku}** (${bestMailer.inside_length_in}×${bestMailer.inside_width_in}×${bestMailer.inside_height_in} inside). You can change it in the editor.`,
    };
  }

  let notes = f.notes;
  if (bestRsc?.sku) {
    notes = appendNote(
      notes,
      `Suggested box (stock): ${bestRsc.sku} — ${bestRsc.description} (inside ${bestRsc.inside_length_in}×${bestRsc.inside_width_in}×${bestRsc.inside_height_in})`,
    );
  }
  if (bestMailer?.sku) {
    notes = appendNote(
      notes,
      `Suggested mailer (stock): ${bestMailer.sku} — ${bestMailer.description} (inside ${bestMailer.inside_length_in}×${bestMailer.inside_width_in}×${bestMailer.inside_height_in})`,
    );
  }
  return notes !== f.notes ? { notes } : {};
}

/* =========================
   OpenAI call (unchanged)
   ========================= */

async function callOpenAI(params: {
  messages: { role: "bot" | "user"; text: string }[];
  userText: string;
  facts: WidgetFacts;
  materialOptions: DbMaterial[];
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
            "- shipping: box vs mailer vs unsure (fit matters)\n" +
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
            "- firstCavity: first rectangular pocket size as LxWxD (in), if user provides it\n" +
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
                "layerCount",
                "layerThicknesses",
                "firstCavity",
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
                layerCount: { anyOf: [{ type: "string", enum: ["1", "2", "3", "4"] }, { type: "null" }] },
                layerThicknesses: { anyOf: [{ type: "array", items: { type: "string" }, maxItems: 4 }, { type: "null" }] },
                firstCavity: { type: ["string", "null"] },
                notes: { type: ["string", "null"] },
                createdAtIso: { type: ["string", "null"] },
              },
            },
          },
        },
      },
    },
  };

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as Incoming;

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const userText = String(payload.userText ?? "").trim();
    const facts = (payload.facts ?? {}) as WidgetFacts;

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

    let materialOptions: DbMaterial[] = [];
    const shouldOfferFoam = wantsFoamRecommendation(userText, facts);
    if (shouldOfferFoam) {
      const familyHint = inferFamilyHint(userText, facts);
      materialOptions = await getTopMaterialsForWidget({ familyHint, limit: 3 });
    }

    const pickedFromText = materialOptions.length ? pickMaterialFromUserText(userText, materialOptions) : null;

    const rawObj = await callOpenAI({ messages, userText, facts, materialOptions });
    const parsed = normalizeBrainObj(rawObj);

    if (!parsed) {
      return NextResponse.json(
        {
          assistantMessage: "Got it. Real quick — what’s the outside foam size (L×W×H, inches) and the quantity?",
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
      }
    }

    const mergedFacts: WidgetFacts = { ...facts, ...nextFacts };

    let assistantMessage = parsed.assistantMessage;

    const pack = await maybeSeedPackagingFromBoxesSuggest({ mergedFacts });

    if (pack.packagingSku) {
      nextFacts.packagingSku = pack.packagingSku;
      mergedFacts.packagingSku = pack.packagingSku;
    }
    if (pack.notes) {
      nextFacts.notes = pack.notes;
      mergedFacts.notes = pack.notes;
    }
    if (pack.messageAddon) {
      assistantMessage = `${assistantMessage}\n\n${pack.messageAddon}`;
    }

    const done = parsed.done && isReady(mergedFacts);

    return NextResponse.json(
      {
        assistantMessage,
        facts: nextFacts,
        done,
        quickReplies: (parsed.quickReplies ?? []).slice(0, 6),
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error("widget_chat_route_error", String(e?.message ?? e));
    return NextResponse.json(
      {
        assistantMessage: "I’m here — quick hiccup on my side. Try again with outside size (L×W×H) and qty.",
        facts: {},
        done: false,
        quickReplies: ["18x12x3", "Qty 250", "Shipping: box", "Shipping: mailer"],
      },
      { status: 200 },
    );
  }
}