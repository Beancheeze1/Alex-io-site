// app/api/uploads/sketch/route.ts
import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { statSync, createReadStream, existsSync } from "fs";
import { join, extname } from "path";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROOT = join(process.cwd(), "data", "uploads");
const META = (id: string) => join(ROOT, `${id}.json`);
const FILE = (id: string, ext: string) => join(ROOT, `${id}${ext}`);

type Meta = {
  id: string;
  name: string;
  ext: string;
  size: number;
  mime: string;
  createdAt: string;
  threadId?: string | number;
  internetMessageId?: string;
  from?: string;
  subject?: string;
  notes?: string;
};

async function ensureRoot() {
  await mkdir(ROOT, { recursive: true });
}

function sanitizeName(n?: string | null) {
  const base = (n || "upload").replace(/[^\w.\-()+]/g, "_");
  return base.slice(0, 120);
}

// POST multipart/form-data: file + optional fields
export async function POST(req: NextRequest) {
  try {
    await ensureRoot();

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "file required" }, { status: 400 });
    }

    const threadId = form.get("threadId")?.toString() || undefined;
    const internetMessageId = form.get("internetMessageId")?.toString() || undefined;
    const from = form.get("from")?.toString() || undefined;
    const subject = form.get("subject")?.toString() || undefined;
    const notes = form.get("notes")?.toString() || undefined;

    const arrayBuffer = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    const orig = sanitizeName((file as any).name || "sketch");
    const ext = extname(orig) || ".bin";
    const id = crypto.randomBytes(8).toString("hex");

    const meta: Meta = {
      id,
      name: orig,
      ext,
      size: buf.length,
      mime: (file as any).type || "application/octet-stream",
      createdAt: new Date().toISOString(),
      threadId,
      internetMessageId,
      from,
      subject,
      notes,
    };

    await writeFile(FILE(id, ext), buf);
    await writeFile(META(id), JSON.stringify(meta, null, 2), "utf8");

    return NextResponse.json({ ok: true, id, meta, download: `/api/uploads/sketch/${id}` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "upload failed" }, { status: 500 });
  }
}

// GET ?threadId=... | ?internetMessageId=...
// Returns metadata list (no binary)
export async function GET(req: NextRequest) {
  try {
    await ensureRoot();
    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId");
    const internetMessageId = searchParams.get("internetMessageId");

    const files = (await readdir(ROOT)).filter((f) => f.endsWith(".json"));
    const all: Meta[] = [];
    for (const f of files) {
      const meta: Meta = JSON.parse(await readFile(join(ROOT, f), "utf8"));
      all.push(meta);
    }

    const filtered = all.filter((m) => {
      if (threadId && String(m.threadId || "") !== String(threadId)) return false;
      if (internetMessageId && (m.internetMessageId || "") !== internetMessageId) return false;
      return true;
    });

    return NextResponse.json({ ok: true, count: filtered.length, items: filtered });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "list failed" }, { status: 500 });
  }
}
