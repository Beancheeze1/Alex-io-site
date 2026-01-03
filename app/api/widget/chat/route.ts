// app/api/widget/chat/route.ts
import { NextRequest, NextResponse } from "next/server";

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

  // layers (structured)
  layerCount?: "1" | "2" | "3" | "4";
  layerThicknesses?: string[]; // e.g. ["3","1"] for 2 layers: base=3, top=1

  // NEW: cavity seed (rect only, LxWxD)
  firstCavity?: string;

  notes?: string;
  createdAtIso?: string;
};

type Incoming = {
  messages?: { role: "bot" | "user"; text: string }[];
  userText?: string;
  facts?: WidgetFacts;
};

function clip(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function hasCoreDims(f: WidgetFacts) {
  return Boolean(f.outsideL && f.outsideW && f.outsideH);
}

// Minimal “ready” gate for reveal: dims + qty + shipping + insertType + holding.
function isReady(f: WidgetFacts) {
  const qtyOk = Boolean(f.qty && String(f.qty).trim().length > 0);
  const shipOk = Boolean(f.shipMode && f.shipMode !== ("" as any));
  const insertOk = Boolean(f.insertType && f.insertType !== ("" as any));
  const holdingOk = Boolean(f.holding && f.holding !== ("" as any));
  return hasCoreDims(f) && qtyOk && shipOk && insertOk && holdingOk;
}

async function callOpenAI(params: {
  messages: { role: "bot" | "user"; text: string }[];
  userText: string;
  facts: WidgetFacts;
}) {
  const apiKey = requireEnv("OPENAI_API_KEY");

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
            "- material: known text or recommend\n" +
            "- layers: layerCount (1–4) and layerThicknesses array\n" +
            "  Convention: Layer 1 = base/body, higher layers stack upward (top pad/lid is last layer).\n" +
            "- firstCavity: first rectangular pocket size as LxWxD (in), if user provides it\n" +
            "- notes\n\n" +
            'When shipping is box or mailer, mention briefly we typically undersize foam L/W by 0.125" for drop-in fit.\n' +
            "When you have enough info, done=true and invite them to open layout & pricing.",
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
              4000
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
            quickReplies: {
              type: "array",
              items: { type: "string" },
              maxItems: 6,
            },
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

                shipMode: {
                  anyOf: [
                    { type: "string", enum: ["box", "mailer", "unsure"] },
                    { type: "null" },
                  ],
                },

                insertType: {
                  anyOf: [
                    { type: "string", enum: ["single", "set", "unsure"] },
                    { type: "null" },
                  ],
                },

                pocketsOn: {
                  anyOf: [
                    { type: "string", enum: ["base", "top", "both", "unsure"] },
                    { type: "null" },
                  ],
                },

                holding: {
                  anyOf: [
                    { type: "string", enum: ["pockets", "loose", "unsure"] },
                    { type: "null" },
                  ],
                },

                pocketCount: {
                  anyOf: [
                    { type: "string", enum: ["1", "2", "3+", "unsure"] },
                    { type: "null" },
                  ],
                },

                materialMode: {
                  anyOf: [
                    { type: "string", enum: ["recommend", "known"] },
                    { type: "null" },
                  ],
                },

                materialText: { type: ["string", "null"] },

                layerCount: {
                  anyOf: [{ type: "string", enum: ["1", "2", "3", "4"] }, { type: "null" }],
                },
                layerThicknesses: {
                  anyOf: [
                    { type: "array", items: { type: "string" }, maxItems: 4 },
                    { type: "null" },
                  ],
                },

                // NEW: first cavity
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
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`openai_http_${res.status}_${txt.slice(0, 220)}`);
  }

  const json = (await res.json()) as any;

  const outputObj =
    json?.output_json && typeof json.output_json === "object" ? json.output_json : null;

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
  return obj as {
    assistantMessage: string;
    facts: Partial<WidgetFacts>;
    done: boolean;
    quickReplies: string[];
  };
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
        { status: 200 }
      );
    }

    const rawObj = await callOpenAI({ messages, userText, facts });
    const parsed = normalizeBrainObj(rawObj);

    if (!parsed) {
      return NextResponse.json(
        {
          assistantMessage:
            "Got it. Real quick — what’s the outside foam size (L×W×H, inches) and the quantity?",
          facts: {},
          done: false,
          quickReplies: ["18x12x3", "Qty 250", "Not sure yet"],
        },
        { status: 200 }
      );
    }

    const mergedFacts = { ...facts, ...parsed.facts };
    const done = parsed.done && isReady(mergedFacts);

    return NextResponse.json(
      {
        assistantMessage: parsed.assistantMessage,
        facts: parsed.facts,
        done,
        quickReplies: (parsed.quickReplies ?? []).slice(0, 6),
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("widget_chat_route_error", String(e?.message ?? e));
    return NextResponse.json(
      {
        assistantMessage:
          "I’m here — quick hiccup on my side. Try again with outside size (L×W×H) and qty.",
        facts: {},
        done: false,
        quickReplies: ["18x12x3", "Qty 250", "Shipping: box", "Shipping: mailer"],
      },
      { status: 200 }
    );
  }
}
