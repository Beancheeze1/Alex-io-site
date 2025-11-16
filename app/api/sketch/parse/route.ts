// app/api/sketch/parse/route.ts
//
// Vision parser for uploaded sketch files.
//
// Usage (POST JSON):
//   { "quote_no": "Q-AI-20251116-223023" }
//      -> parses the most recent attachment for that quote
//
//   { "attachmentId": 4 }
//      -> parses that specific attachment
//
// Output:
//   {
//     ok: true,
//     attachmentId: 4,
//     quoteId: 31,
//     quoteNo: "Q-AI-...",
//     parsed: {
//       dims: "10x10x3",
//       qty: 250,
//       material: "EPE",
//       density: "1.7#",
//       cavityCount: 2,
//       cavityDims: ["6x0.5", "1x1x0.5"],
//       notes: "optional clarification text"
//     }
//   }
//
// Also stores the parsed JSON into quote_attachments.notes.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ParseInput = {
  quote_no?: string;
  attachmentId?: number;
};

type AttachmentRow = {
  id: number;
  quote_id: number | null;
  quote_no: string | null;
  filename: string;
  content_type: string | null;
  size_bytes?: number | null;
  data: Buffer | Uint8Array | string;
};

type ParsedSketch = {
  dims?: string | null;
  qty?: number | null;
  material?: string | null;
  density?: string | null;
  cavityCount?: number | null;
  cavityDims?: string[] | null;
  notes?: string | null;
};

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ParseInput;
    const quoteNo = body.quote_no?.trim();
    const attachmentId = body.attachmentId;

    if (!quoteNo && !attachmentId) {
      return err("missing_input", "Provide quote_no or attachmentId");
    }

    // 1) Load the attachment row
    let attachment: AttachmentRow | null = null;

    if (attachmentId) {
      attachment = await one<AttachmentRow>(
        `
        SELECT id, quote_id, quote_no, filename, content_type, size_bytes, data
        FROM quote_attachments
        WHERE id = $1
        LIMIT 1;
        `,
        [attachmentId]
      );
    } else if (quoteNo) {
      attachment = await one<AttachmentRow>(
        `
        SELECT id, quote_id, quote_no, filename, content_type, size_bytes, data
        FROM quote_attachments
        WHERE quote_no = $1
        ORDER BY created_at DESC
        LIMIT 1;
        `,
        [quoteNo]
      );
    }

    if (!attachment) {
      return err("attachment_not_found", { quoteNo, attachmentId }, 404);
    }

    if (!attachment.data) {
      return err("attachment_has_no_data", { attachmentId: attachment.id }, 500);
    }

    const contentType =
      attachment.content_type || "application/octet-stream";

    // 2) Convert binary data to base64 for vision
    const buf = Buffer.isBuffer(attachment.data)
      ? attachment.data
      : Buffer.from(attachment.data as any);
    const base64 = buf.toString("base64");
    const dataUrl = `data:${contentType};base64,${base64}`;

    // 3) Call OpenAI Vision (Responses API) to parse the sketch
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return err("missing_openai_key", "OPENAI_API_KEY not set", 500);
    }

    const prompt = `
You are a foam packaging sketch parser.

You will see a sketch or drawing of a foam insert or block. From this image, extract:
- dims: overall outside block size in inches, formatted "LxWxH"
- qty: quantity of pieces (integer) if clearly indicated
- material: foam type (e.g. "PE", "EPE", "XLPE", "polyurethane", "kaizen") if visible
- density: foam density like "1.7#" or "2.2#" if visible
- cavityCount: number of distinct cavities/pockets/cutouts
- cavityDims: array of dimensions for each cavity. 
  Use "LxW" or "LxWxH" format in inches (e.g. "6x3x1", "1x1").
  If diameters are shown, convert to rectangular style like "6x6" or "6x6xdepth"
  (DO NOT use the diameter symbol).
- notes: any short clarification that would help a human estimator,
  e.g. "two identical 6x3x1 cavities side by side", or "thickness under part ~0.5".

If something is unclear, leave that field null.

Return STRICT JSON ONLY in this shape:
{
  "dims": string | null,
  "qty": number | null,
  "material": string | null,
  "density": string | null,
  "cavityCount": number | null,
  "cavityDims": string[] | null,
  "notes": string | null
}
    `.trim();

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt,
              },
              {
                type: "input_image",
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
        max_output_tokens: 256,
        temperature: 0.1,
      }),
    });

    const raw = await resp.text();
    if (!resp.ok) {
      return err("openai_error", { status: resp.status, body: raw }, 500);
    }

    // 4) Extract the JSON blob from the response text
    let parsed: ParsedSketch = {};
    try {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        parsed = JSON.parse(raw.slice(start, end + 1));
      }
    } catch (e) {
      // fall back to empty parsed object if JSON parse fails
      parsed = {};
    }

    // Normalize a bit
    if (parsed && parsed.cavityDims && !Array.isArray(parsed.cavityDims)) {
      parsed.cavityDims = [String(parsed.cavityDims)];
    }

    // 5) Store parsed JSON into quote_attachments.notes for later reference
    try {
      await one(
        `
        UPDATE quote_attachments
        SET notes = $2,
            updated_at = now()
        WHERE id = $1;
        `,
        [attachment.id, JSON.stringify(parsed)]
      );
    } catch (e) {
      // Don't fail the whole request just because the update failed
      console.error("Failed to store parsed sketch notes:", e);
    }

    return NextResponse.json(
      {
        ok: true,
        attachmentId: attachment.id,
        quoteId: attachment.quote_id,
        quoteNo: attachment.quote_no,
        filename: attachment.filename,
        contentType,
        parsed,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("sketch/parse exception:", e);
    return err(
      "sketch_parse_exception",
      String(e?.message || e),
      500
    );
  }
}
