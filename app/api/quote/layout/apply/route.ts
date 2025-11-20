// app/api/quote/layout/apply/route.ts
//
// Path-A stub: accept a layout payload from the layout editor
// and return { ok: true }. Later we can persist the SVG/DXF
// and attach it to the quote record.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Expected shape (for future use):
    // {
    //   quoteNo: string;
    //   layout: {
    //     block: { lengthIn, widthIn, thicknessIn };
    //     cavities: [...];
    //   }
    // }

    // For now we just acknowledge; no DB writes yet.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("quote/layout/apply POST error", err);
    return NextResponse.json(
      { ok: false, error: "Invalid layout payload" },
      { status: 400 }
    );
  }
}
