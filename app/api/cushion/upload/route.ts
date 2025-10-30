// app/api/cushion/upload/route.ts
import { NextResponse } from "next/server";
import { writeFile, readFile, stat } from "fs/promises";
import { join } from "path";

const TMP_PATH = join("/tmp", "cushion_curves.json");
const DATA_PATH = join(process.cwd(), "data", "cushion_curves.json");

async function readJson(path: string) {
  const txt = await readFile(path, "utf8");
  return JSON.parse(txt);
}

function normalize(arr: any): any[] {
  if (!Array.isArray(arr)) throw new Error("JSON root must be an array of foams");
  return arr;
}

// POST: upload curves (multipart or raw JSON). Writes to /tmp/cushion_curves.json
export async function POST(req: Request) {
  try {
    let arr: any[] | null = null;

    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("file");
      if (!(file instanceof File)) throw new Error("Missing 'file'");
      const txt = await file.text();
      arr = normalize(JSON.parse(txt));
    } else {
      const body = await req.json();
      arr = normalize(body);
    }

    await writeFile(TMP_PATH, JSON.stringify(arr, null, 2), "utf8");
    return NextResponse.json({ ok: true, items: arr.length, active_source: "tmp" }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "upload failed" }, { status: 400 });
  }
}

// GET: show active source and simple stats
export async function GET() {
  try {
    let source = "fallback";
    let stats = null;

    let arr: any[] | null = null;
    try {
      const s = await stat(TMP_PATH);
      if (s.isFile()) {
        source = "tmp";
        arr = await readJson(TMP_PATH);
      }
    } catch {}

    if (!arr) {
      try {
        const s = await stat(DATA_PATH);
        if (s.isFile()) {
          source = "data";
          arr = await readJson(DATA_PATH);
        }
      } catch {}
    }

    if (arr) {
      // stats: series count
      const foams = arr.length;
      const series = arr.reduce((n: number, f: any) => n + (Array.isArray(f.series) ? f.series.length : 0), 0);
      stats = { foams, series };
    }

    return NextResponse.json({ ok: true, active_source: source, stats }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "inspect failed" }, { status: 500 });
  }
}
