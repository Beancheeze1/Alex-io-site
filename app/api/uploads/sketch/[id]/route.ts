// app/api/uploads/sketch/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROOT = join(process.cwd(), "data", "uploads");

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    // load meta to discover ext & mime
    const metaPath = join(ROOT, `${id}.json`);
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    const filePath = join(ROOT, `${id}${meta.ext}`);
    const bin = await readFile(filePath);

    return new NextResponse(bin, {
      status: 200,
      headers: {
        "Content-Type": meta.mime || "application/octet-stream",
        "Content-Disposition": `inline; filename="${meta.name}"`,
        "Cache-Control": "private, max-age=31536000",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
}
