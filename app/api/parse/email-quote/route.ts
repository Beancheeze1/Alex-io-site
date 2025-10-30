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

    const warn: string[] = [];
    const dims = [parsed.length_in, parsed.width_in, parsed.height_in].filter(v => typeof v === "number") as number[];
    if (dims.length === 3 && dims.some(n => (n ?? 0) <= 0)) warn.push("Outer dimensions must be > 0.");
    if (dims.length === 3 && Math.max(...dims) > 120) warn.push("An outer dimension > 120\" seems unlikely for foam blocks.");

    // Shape-normalized “foam quote body”
    const foam_quote_body = {
      length_in: parsed.length_in,
      width_in: parsed.width_in,
      height_in: parsed.height_in,
      qty: parsed.qty ?? 1,
      material_id: 1,
      cavities: parsed.cavities.map(c =>
        (c.label === "circle" || c.label === "round")
          ? { label: "circle", count: c.count, dia: c.dia, d: c.d } // keep true circle for pricing
          : { label: c.label === "rect" ? "slot" : c.label, count: c.count, w: c.w, l: c.l, d: c.d }
      ),
      meta: {
        material_hint: parsed.material_hint,
        density_hint: parsed.density_hint,
      }
    };

    return NextResponse.json({
      ok: true,
      parsed,
      warnings: warn,
      foam_quote_body,
      tip: "POST this foam_quote_body to /api/quote/foam to price it."
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
