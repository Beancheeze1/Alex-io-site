// app/api/ai/extract/route.ts
import { NextRequest, NextResponse } from "next/server";
import { extractSpecs } from "@/app/lib/ai/extract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Input = { text: string };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<Input>;
    const raw = String(body?.text ?? "");
    const ex = extractSpecs(raw);

    const missing: string[] = [];
    if (!ex.dims) missing.push("final outside dimensions (L × W × H)");
    if (!ex.qty) missing.push("quantity");
    if (!ex.density_pcf) missing.push("foam density (e.g., 1.7 pcf)");
    if (ex.thickness_under_in == null) missing.push("thickness under the part");
    if (!ex.unitsMentioned) missing.push("units (in or mm)");

    const quote_ready =
      !!ex.dims && !!ex.qty && !!ex.density_pcf && ex.unitsMentioned;

    return NextResponse.json(
      { ok: true, extracted: ex, missing, quote_ready },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "extract error" },
      { status: 500 }
    );
  }
}
