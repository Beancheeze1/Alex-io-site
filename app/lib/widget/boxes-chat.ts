// app/lib/widget/boxes-chat.ts
//
// Step 12: the chat widget's boxes-only conversation. Used by
// /api/widget/chat once the conversation is about corrugated boxes (the shop
// offers only Boxes only, or the buyer said they just need boxes).
//
// Collects one box size: inside L x W x D (inches), style (RSC or mailer),
// quantity, printing (plain, or 1-4 colors with spot/flood for each color and
// one or two sides), then name and email. The widget hands the facts to Start
// Quote (Boxes only, review step), where the buyer checks them and can add
// compare quantities, artwork or more sizes before getting the price.

export type BoxStyle = "rsc" | "mailer";
export type Coverage = "spot" | "flood";

export type BoxChatFacts = {
  quoteKind?: "foam" | "boxes" | null;
  boxL?: string | null;
  boxW?: string | null;
  boxD?: string | null;
  boxStyle?: BoxStyle | null;
  qty?: string | null;
  printed?: boolean | null;
  printColorCount?: "1" | "2" | "3" | "4" | null;
  printColors?: Coverage[] | null;
  printSides?: "1" | "2" | null;
  customerName?: string | null;
  customerEmail?: string | null;
  notes?: string | null;
  createdAtIso?: string;
  salesRepSlug?: string;
  [key: string]: unknown;
};

export type ChatTurn = {
  assistantMessage: string;
  facts: BoxChatFacts;
  done: boolean;
  quickReplies: string[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FOAM_WORDS = /\b(foam|inserts?|cavit(?:y|ies)|pockets?|cushion(?:ing)?|trays?|pads?|polyethylene|polyurethane|xlpe|epe)\b/i;
const BOX_WORDS = /\b(box|boxes|cartons?|corrugated|rsc|shippers?|mailers?)\b/i;

/**
 * What the buyer wants from their own words: foam (any foam, with or without
 * a box) or boxes only. null = can't tell yet.
 */
export function detectQuoteKind(text: string): "foam" | "boxes" | null {
  const t = String(text || "");
  if (/\b(no foam|without foam|just (the )?(boxes|cartons)|boxes only|only (the )?(boxes|cartons))\b/i.test(t)) {
    return "boxes";
  }
  if (FOAM_WORDS.test(t)) return "foam";
  if (BOX_WORDS.test(t)) return "boxes";
  return null;
}

function isBlank(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

function colorCount(f: BoxChatFacts): number {
  const n = Number(f.printColorCount);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 0;
}

function hasDims(f: BoxChatFacts): boolean {
  return [f.boxL, f.boxW, f.boxD].every((v) => Number(v) > 0);
}

function printSettled(f: BoxChatFacts): boolean {
  if (f.printed === false) return true;
  if (f.printed !== true) return false;
  const n = colorCount(f);
  return n > 0 && Array.isArray(f.printColors) && f.printColors.length === n && (f.printSides === "1" || f.printSides === "2");
}

export function isBoxesReady(f: BoxChatFacts): boolean {
  return (
    hasDims(f) &&
    (f.boxStyle === "rsc" || f.boxStyle === "mailer") &&
    Number(f.qty) > 0 &&
    printSettled(f) &&
    !!String(f.customerName || "").trim() &&
    EMAIL_RE.test(String(f.customerEmail || "").trim())
  );
}

function coverageReplies(n: number): string[] {
  if (n === 1) return ["Spot", "Flood"];
  if (n === 2) return ["Both spot", "Both flood", "1 spot, 1 flood"];
  return ["All spot", "All flood", "Mix of spot and flood"];
}

/** The next field to ask about, in order. */
export function nextBoxQuestion(f: BoxChatFacts): { assistantMessage: string; quickReplies: string[]; done: boolean } {
  if (!hasDims(f)) {
    return {
      assistantMessage: "What inside size do you need? Length × width × depth, in inches.",
      quickReplies: ["12x10x8", "16x12x6", "Not sure yet"],
      done: false,
    };
  }
  if (f.boxStyle !== "rsc" && f.boxStyle !== "mailer") {
    return {
      assistantMessage: "RSC (a regular slotted shipper, tape-sealed) or a mailer (tuck-top lid, no tape)?",
      quickReplies: ["RSC / shipper", "Mailer"],
      done: false,
    };
  }
  if (!(Number(f.qty) > 0)) {
    return { assistantMessage: "How many boxes?", quickReplies: ["Qty 250", "Qty 500", "Qty 1000"], done: false };
  }
  if (f.printed == null) {
    return { assistantMessage: "Plain boxes, or printed?", quickReplies: ["Plain (no print)", "Printed"], done: false };
  }
  if (f.printed === true) {
    const n = colorCount(f);
    if (!n) {
      return {
        assistantMessage: "How many print colors? (Up to 4 online.)",
        quickReplies: ["1 color", "2 colors", "3 colors", "4 colors"],
        done: false,
      };
    }
    if (!Array.isArray(f.printColors) || f.printColors.length !== n) {
      return {
        assistantMessage:
          n === 1
            ? "Is that color spot (text, lines, logos) or flood (large solid areas)?"
            : "For each color: spot (text, lines, logos) or flood (large solid areas)?",
        quickReplies: coverageReplies(n),
        done: false,
      };
    }
    if (f.printSides !== "1" && f.printSides !== "2") {
      return { assistantMessage: "Print on one side of the box, or two?", quickReplies: ["One side", "Two sides"], done: false };
    }
  }
  if (!String(f.customerName || "").trim()) {
    return { assistantMessage: "Great — what's your full name?", quickReplies: [], done: false };
  }
  if (!EMAIL_RE.test(String(f.customerEmail || "").trim())) {
    return { assistantMessage: "And the best email for the quote?", quickReplies: [], done: false };
  }
  return {
    assistantMessage: "Perfect — I've got everything for your box quote. Open it to check the details and get your price.",
    quickReplies: [],
    done: true,
  };
}

/** Plain-text extraction that doesn't need the AI (runs before it). */
export function extractBoxFacts(userText: string, f: BoxChatFacts): Partial<BoxChatFacts> {
  const t = String(userText || "").trim();
  const next: Partial<BoxChatFacts> = {};

  if (!hasDims(f)) {
    const m = t.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
    if (m) {
      next.boxL = m[1];
      next.boxW = m[2];
      next.boxD = m[3];
    }
  }

  const qtyMatch = t.match(/\b(?:qty|quantity)\b\s*[:#-]?\s*(\d[\d,]*)\b/i) || t.match(/(?<![x×\d.])\b(\d[\d,]*)\s*(?:pcs|pieces|boxes|cartons|units)\b/i);
  if (qtyMatch) next.qty = qtyMatch[1].replace(/,/g, "");
  else if (!(Number(f.qty) > 0) && hasDims(f) && f.boxStyle && /^\d[\d,]*$/.test(t)) next.qty = t.replace(/,/g, "");
  else if (!(Number(f.qty) > 0)) {
    // "500 12x10x8 boxes": one other whole number besides the size is the quantity.
    const rest = t
      .replace(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/gi, " ")
      .replace(/\b\d+\s*(?:colou?rs?|sides?|in(?:ch(?:es)?)?|")/gi, " ");
    const nums = rest.match(/(?<![\d.])\d[\d,]*(?![\d.])/g) || [];
    if (nums.length === 1 && BOX_WORDS.test(t) && Number(nums[0].replace(/,/g, "")) > 0) next.qty = nums[0].replace(/,/g, "");
  }

  if (/\bmailers?\b/i.test(t)) next.boxStyle = "mailer";
  else if (/\b(rsc|shippers?|regular slotted|shipping box(?:es)?)\b/i.test(t)) next.boxStyle = "rsc";

  if (/\b(plain|unprinted|no print(?:ing)?|not printed)\b/i.test(t)) next.printed = false;
  else if (/\bprint(?:ed|ing)?\b/i.test(t) || /\b\d\s*colou?rs?\b/i.test(t)) next.printed = true;

  const cc = t.match(/\b([1-4])\s*colou?rs?\b/i) || t.match(/\b(one|two|three|four)\s*colou?rs?\b/i);
  if (cc) {
    const words: Record<string, string> = { one: "1", two: "2", three: "3", four: "4" };
    const v = words[cc[1].toLowerCase()] ?? cc[1];
    if (["1", "2", "3", "4"].includes(v)) next.printColorCount = v as BoxChatFacts["printColorCount"];
  }

  const n = Number(next.printColorCount ?? f.printColorCount) || 0;
  if (n > 0) {
    if (/\b(all|both)\s+spot\b/i.test(t) || (n === 1 && /^\s*spot\s*$/i.test(t))) {
      next.printColors = Array.from({ length: n }, () => "spot" as Coverage);
    } else if (/\b(all|both)\s+flood\b/i.test(t) || (n === 1 && /^\s*flood\s*$/i.test(t))) {
      next.printColors = Array.from({ length: n }, () => "flood" as Coverage);
    } else {
      const mix = t.match(/\b(\d)\s*spot\b.*?\b(\d)\s*flood\b/i);
      if (mix && Number(mix[1]) + Number(mix[2]) === n) {
        next.printColors = [
          ...Array.from({ length: Number(mix[1]) }, () => "spot" as Coverage),
          ...Array.from({ length: Number(mix[2]) }, () => "flood" as Coverage),
        ];
      }
    }
  }

  if (/\b(two|2|both)\s*sides?\b/i.test(t)) next.printSides = "2";
  else if (/\b(one|1|single)\s*sides?\b/i.test(t)) next.printSides = "1";

  const em = t.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (em) next.customerEmail = em[0].replace(/[.,;]+$/, "");

  // A plain name typed when the chat is asking for the name.
  if (!String(f.customerName || "").trim() && /full name/.test(nextBoxQuestion(f).assistantMessage)) {
    const explicit = t.match(/\b(?:my name is|i am|i'm|this is)\s+(.+)$/i);
    const cand = (explicit ? explicit[1] : t).trim().replace(/[.,!]+$/, "");
    const words = cand.split(/\s+/);
    if (words.length >= 1 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z'’-]*$/.test(w))) {
      next.customerName = cand;
    }
  }

  return next;
}

function normalize(f: BoxChatFacts): BoxChatFacts {
  const out: BoxChatFacts = { ...f, quoteKind: "boxes" };
  if (out.printed === false) {
    out.printColorCount = null;
    out.printColors = null;
    out.printSides = null;
  }
  const n = colorCount(out);
  if (n && Array.isArray(out.printColors)) {
    out.printColors = out.printColors.filter((c) => c === "spot" || c === "flood").slice(0, n);
  }
  if (n && !out.printed) out.printed = true;
  return out;
}

const PRESERVE: (keyof BoxChatFacts)[] = [
  "boxL", "boxW", "boxD", "boxStyle", "qty", "printed", "printColorCount", "printColors", "printSides",
  "customerName", "customerEmail", "notes",
];

async function callOpenAIBoxes(args: {
  messages: { role: "bot" | "user"; text: string }[];
  userText: string;
  facts: BoxChatFacts;
  guidance: string;
}): Promise<{ assistantMessage: string; facts: Partial<BoxChatFacts>; done: boolean; quickReplies: string[] } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing env: OPENAI_API_KEY");

  const systemPrompt =
    "You are a packaging shop's website quoting chat for CORRUGATED BOXES ONLY (no foam). Have a natural, " +
    "confident conversation and extract the facts for a box quote.\n\n" +
    "RULES:\n" +
    "- Ask ONE question at a time. Keep replies to 1-2 short sentences.\n" +
    "- Never invent facts. If unsure, ask.\n" +
    "- When the user gives several facts at once, acknowledge them and move on.\n" +
    "- Never quote a price; the quote form calculates it.\n" +
    "- Up to 6 short quick replies when useful.\n" +
    "- When asking for the name or email, leave quickReplies empty. Never suggest example names or emails.\n\n" +
    "FIELDS:\n" +
    "- boxL, boxW, boxD: the box INSIDE dimensions in inches, length x width x depth. '12x10x8' -> boxL='12', boxW='10', boxD='8'.\n" +
    "- boxStyle: 'rsc' (regular slotted container / shipper, tape-sealed) or 'mailer' (tuck-top lid, no tape).\n" +
    "- qty: number of boxes, digits only.\n" +
    "- printed: false for plain boxes, true if they want printing.\n" +
    "- printColorCount: '1'-'4' when printed. More than 4 colors: set '4' and say the shop will confirm extra colors.\n" +
    "- printColors: one entry per color, each 'spot' (text, lines, logos) or 'flood' (large solid areas), length = printColorCount. " +
    "'both spot' with 2 colors -> ['spot','spot']; '1 spot 1 flood' -> ['spot','flood']. Leave null until they answer.\n" +
    "- printSides: '1' (one side) or '2' (two sides).\n" +
    "- customerName, customerEmail.\n" +
    "- notes: anything else important they say (e.g. 'need by March', 'kraft color').\n" +
    "When printed is false, leave printColorCount, printColors and printSides null.\n" +
    "Set done=true only when every field above (except notes) is known; then invite them to open their quote to check it and get the price.";

  const context =
    "Current known facts JSON:\n" +
    JSON.stringify(args.facts ?? {}).slice(0, 2000) +
    "\n\nConversation so far (most recent last):\n" +
    (args.messages ?? [])
      .slice(-12)
      .map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.text}`)
      .join("\n")
      .slice(0, 4000) +
    `\n\n${args.guidance}` +
    "\n\nNewest user message:\n" +
    String(args.userText).slice(0, 800);

  const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
  const schema = {
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
          "boxL", "boxW", "boxD", "boxStyle", "qty", "printed", "printColorCount", "printColors", "printSides",
          "customerName", "customerEmail", "notes",
        ],
        properties: {
          boxL: { type: ["string", "null"] },
          boxW: { type: ["string", "null"] },
          boxD: { type: ["string", "null"] },
          boxStyle: nullable({ type: "string", enum: ["rsc", "mailer"] }),
          qty: { type: ["string", "null"] },
          printed: nullable({ type: "boolean" }),
          printColorCount: nullable({ type: "string", enum: ["1", "2", "3", "4"] }),
          printColors: nullable({ type: "array", items: { type: "string", enum: ["spot", "flood"] }, maxItems: 4 }),
          printSides: nullable({ type: "string", enum: ["1", "2"] }),
          customerName: { type: ["string", "null"] },
          customerEmail: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
        },
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-2024-08-06",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context },
        ],
        response_format: { type: "json_schema", json_schema: { name: "widget_boxes_chat", strict: true, schema } },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`openai_http_${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json?.choices?.[0]?.message?.content;
  if (!content) return null;
  const obj = JSON.parse(String(content).trim());
  if (!obj || typeof obj.assistantMessage !== "string" || typeof obj.done !== "boolean") return null;
  return {
    assistantMessage: obj.assistantMessage,
    facts: obj.facts && typeof obj.facts === "object" ? obj.facts : {},
    done: obj.done,
    quickReplies: Array.isArray(obj.quickReplies) ? obj.quickReplies : [],
  };
}

/** One boxes-only chat turn. */
export async function handleBoxesTurn(args: {
  messages: { role: "bot" | "user"; text: string }[];
  userText: string;
  facts: BoxChatFacts;
}): Promise<ChatTurn> {
  const prior = normalize({ ...args.facts, quoteKind: "boxes" });
  const seeded = normalize({ ...prior, ...extractBoxFacts(args.userText, prior) });

  const guide = nextBoxQuestion(seeded);
  const guidance = guide.done
    ? "SYSTEM NOTE: Every required field is known. Confirm briefly and invite them to open their quote."
    : `SYSTEM NOTE: If the newest message doesn't already answer it, the next field to ask about is: "${guide.assistantMessage}" ` +
      "Put it in your own words as part of a natural reply. Don't skip ahead.";

  let ai: Awaited<ReturnType<typeof callOpenAIBoxes>> = null;
  try {
    ai = await callOpenAIBoxes({ messages: args.messages, userText: args.userText, facts: seeded, guidance });
  } catch (e) {
    console.error("[widget/boxes-chat] AI call failed; using the scripted question", e);
  }

  if (!ai) {
    return { assistantMessage: guide.assistantMessage, facts: seeded, done: guide.done, quickReplies: guide.quickReplies };
  }

  // The AI returns every field each turn (null when not discussed): never let a
  // null/empty overwrite something already known.
  const fromAi: Partial<BoxChatFacts> = { ...ai.facts };
  for (const k of PRESERVE) {
    if (isBlank(fromAi[k]) && !isBlank(seeded[k])) (fromAi as Record<string, unknown>)[k] = seeded[k];
  }
  // Plain-text extraction of this message wins over the AI for the same field.
  const merged = normalize({ ...seeded, ...fromAi, ...extractBoxFacts(args.userText, prior) });

  const done = ai.done && isBoxesReady(merged);
  const next = nextBoxQuestion(merged);
  // Name / email questions never get quick replies (the AI sometimes invents an example email).
  const asksContact = /full name|email/i.test(next.assistantMessage);
  const quickReplies =
    done || asksContact ? [] : ai.quickReplies.length >= 2 ? ai.quickReplies.slice(0, 6) : next.quickReplies;

  return { assistantMessage: ai.assistantMessage, facts: merged, done, quickReplies };
}
