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
// (Material can be recommended; notes optional.)
function isReady(f: WidgetFacts) {
  const qtyOk = Boolean(f.qty && String(f.qty).trim().length > 0);
  const shipOk = Boolean(f.shipMode && f.shipMode !== undefined && f.shipMode !== ("" as any));
  const insertOk = Boolean(
    f.insertType && f.insertType !== undefined && f.insertType !== ("" as any)
  );
  const holdingOk = Boolean(
    f.holding && f.holding !== undefined && f.holding !== ("" as any)
  );
  return hasCoreDims(f) && qtyOk && shipOk && insertOk && holdingOk;
}

async function callOpenAI(params: {
  messages: { role: "bot" | "user"; text: string }[];
  userText: string;
  facts: WidgetFacts;
}) {
  const apiKey = requireEnv("OPENAI_API_KEY");

  // Allow override in Render without code edits:
  // OPENAI_WIDGET_MODEL=gpt-5-mini (recommended default for compatibility)
  const model = (process.env.OPENAI_WIDGET_MODEL || "gpt-5-mini").trim();

  const inputMessages = [
    {
      role: "developer",
      content: [
        {
          type: "text",
          text:
            "You are Alex-IO’s website chat widget. Your job is to have a natural, confident conversation " +
            "and extract quoting facts for a foam packaging insert quote. " +
            "IMPORTANT RULES:\n" +
            "- Be chatty like a helpful expert, not a form.\n" +
            "- Ask ONE question at a time.\n" +
            "- Never invent facts. If unsure, ask.\n" +
            "- Keep answers short (1–3 short paragraphs).\n" +
            "- When user gives multiple facts at once, acknowledge + move on.\n" +
            "- You must update a structured facts object.\n" +
            "- You must propose up to 6 quick replies when useful.\n\n" +
            "Fields you care about:\n" +
            "- outside size L×W×H (in)\n" +
            "- qty\n" +
            "- shipping: box vs mailer vs unsure (fit matters)\n" +
            "- insert type: single vs set (base + top pad/lid)\n" +
            "- holding: cut-out pockets vs loose vs unsure\n" +
            "- pocketsOn: base/top/both if set\n" +
            "- pocketCount: 1/2/3+/unsure if pockets\n" +
            "- material: known text or recommend\n" +
            "- notes\n\n" +
            "When shipping is box or mailer, mention (briefly) that we typically undersize foam L/W by 0.125\" for drop-in fit.\n" +
            "When you have enough info, set done=true and the assistant message should invite them to open layout & pricing.",
        },
      ],
    },
    {
      role: "developer",
      content: [
        {
          type: "text",
          text:
            "Return ONLY valid JSON (no markdown) matching this shape:\n" +
            "{\n" +
            '  "assistantMessage": string,\n' +
            '  "facts": { ...partial updates... },\n' +
            '  "done": boolean,\n' +
            '  "quickReplies": string[]\n' +
            "}\n" +
            "Facts enums:\n" +
            'shipMode: "box"|"mailer"|"unsure"\n' +
            'insertType: "single"|"set"|"unsure"\n' +
            'pocketsOn: "base"|"top"|"both"|"unsure"\n' +
            'holding: "pockets"|"loose"|"unsure"\n' +
            'pocketCount: "1"|"2"|"3+"|"unsure"\n' +
            'materialMode: "recommend"|"known"\n',
        },
      ],
    },
    {
      role: "developer",
      content: [
        {
          type: "text",
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
    model,
    reasoning: { effort: "low" },
    input: inputMessages,
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
    throw new Error(`openai_http_${res.status}_${txt.slice(0, 200)}`);
  }

  const json = (await res.json()) as any;

  const outputText: string =
    typeof json?.output_text === "string"
      ? json.output_text
      : (json?.output?.[0]?.content?.find?.((c: any) => c?.type === "output_text")?.text ?? "");

  return String(outputText || "").trim();
}

function safeParseBrainJson(raw: string) {
  try {
    const obj = JSON.parse(raw);
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
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let debugWhere = "";
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

    debugWhere = "callOpenAI";
    const raw = await callOpenAI({ messages, userText, facts });

    debugWhere = "parseBrainJson";
    const parsed = safeParseBrainJson(raw);

    if (!parsed) {
      return NextResponse.json(
        {
          assistantMessage:
            "Got it. Real quick — what’s the outside foam size (L×W×H, inches) and the quantity?",
          facts: {},
          done: false,
          quickReplies: ["18x12x3", "Qty 250", "Not sure yet"],
          debug: {
            where: "model_returned_non_json",
            model: (process.env.OPENAI_WIDGET_MODEL || "gpt-5-mini").trim(),
          },
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
    const errMsg = String(e?.message ?? e ?? "unknown_error");

    return NextResponse.json(
      {
        assistantMessage:
          "I’m here — quick hiccup on my side. Try again with outside size (L×W×H) and qty.",
        facts: {},
        done: false,
        quickReplies: ["18x12x3", "Qty 250", "Shipping: box", "Shipping: mailer"],
        debug: {
          where: debugWhere || "route",
          error: errMsg,
          missingKey: errMsg.includes("Missing env: OPENAI_API_KEY") ? "OPENAI_API_KEY" : "",
          model: (process.env.OPENAI_WIDGET_MODEL || "gpt-5-mini").trim(),
        },
      },
      { status: 200 }
    );
  }
}
