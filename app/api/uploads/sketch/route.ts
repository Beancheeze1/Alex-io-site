import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Accepts: multipart/form-data with field "file"
// Returns: { ok: true, id, size, mime, filename, sketchRef }
export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json(
        { ok: false, error: "Content-Type must be multipart/form-data" },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const f = form.get("file");

    if (!f || !(f instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Missing file field 'file'." },
        { status: 400 }
      );
    }

    const mime = f.type || "application/octet-stream";
    const allowed = ["image/png", "image/jpeg", "application/pdf"];
    if (!allowed.includes(mime)) {
      return NextResponse.json(
        { ok: false, error: "Only PNG, JPG, or PDF allowed." },
        { status: 415 }
      );
    }

    const arr = new Uint8Array(await f.arrayBuffer());
    const id = randomBytes(8).toString("hex");
    const ext =
      mime === "image/png"
        ? "png"
        : mime === "image/jpeg"
        ? "jpg"
        : "pdf";

    // Write to ephemeral disk; on Render this is fine for short-term
    const fileName = `sketch_${id}.${ext}`;
    const fullPath = join(tmpdir(), fileName);
    await writeFile(fullPath, arr);

    // Sketch reference that your orchestrator can store/echo
    // In a future step you can back this with S3/Cloudflare R2 etc.
    const sketchRef = `file://${fullPath}`;

    return NextResponse.json(
      {
        ok: true,
        id,
        size: arr.byteLength,
        mime,
        filename: fileName,
        sketchRef,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "upload error" },
      { status: 500 }
    );
  }
}
