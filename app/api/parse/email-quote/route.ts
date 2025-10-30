import { NextResponse } from "next/server";
import { parseEmailQuote } from "@/lib/email/quoteParser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const text: string = body?.text ?? "";
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Provide { text: \"...email body...\" }" }, { status: 400 });
    }

    const parsed = parseEmailQuote(text);

    // Guardrails (soft warnings)
    const warn: string[] = [];
    const { length_in, width_in, height_in } = parsed;
    const dims = [length_in, width_in, height_in].filter((n) => typeof n === "number") as number[];
    if (dims.length === 3) {
      if (dims.some(n => n <= 0)) warn.push("Outer dimensions must be > 0.");
      if (Math.max(...dims) > 120) warn.push("An outer dimension > 120\" seems unlikely for foam blocks.");
    }

    // Prepare a ready-to-send JSON body for /api/quote/foam
    const foamQuoteBody = {
      length_in: parsed.length_in,
      width_in: parsed.width_in,
      height_in: parsed.height_in,
      qty: parsed.qty ?? 1,
      material_id: 1,             // safe default; UI can override
      cavities: parsed.cavities.map(c => {
        if (c.label === "circle" || c.label === "round") {
          // represent circle as square approxi: dia x dia x d (you can make this a circle later)
          return { label: "square", count: c.count, w: c.dia, l: c.dia, d: c.d };
        }
        return { label: c.label === "rect" ? "slot" : c.label, count: c.count, w: c.w, l: c.l, d: c.d };
      }),
      // extra: could pass material_hint/density_hint if you want UI to suggest a material
      meta: {
        material_hint: parsed.material_hint,
        density_hint: parsed.density_hint,
      }
    };

    return NextResponse.json({
      ok: true,
      parsed,
      warnings: warn,
      foam_quote_body: foamQuoteBody,
      tip: "POST this foam_quote_body to /api/quote/foam to price it.",
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
