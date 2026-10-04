// app/api/uploads/sketch/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROOT = "/tmp/sketches";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id || ""))) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const base = path.join(ROOT, id);

  const tryExt = [".png", ".jpg", ".pdf", ".svg", ".bin"];
  for (const ext of tryExt) {
    try {
      const p = `${base}${ext}`;
      const buf = await fs.readFile(p);
      const mime =
        ext === ".png"
          ? "image/png"
          : ext === ".jpg"
          ? "image/jpeg"
          : ext === ".pdf"
          ? "application/pdf"
          : ext === ".svg"
          ? "image/svg+xml"
          : "application/octet-stream";

      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=86400",
          "Content-Disposition": `inline; filename="${id}${ext}"`,
        },
      });
    } catch {}
  }

  return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
}
