// app/api/quote-attachments/[id]/route.ts
//
// Read-only attachment download by id.
// Returns the raw bytes stored in quote_attachments.data with correct headers.
//
// Used by the editor to fetch normalized.dxf (Forge output) by attachmentId.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Row = {
  id: number;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  data: Buffer;
};

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const rawParam = (ctx?.params?.id ?? "").toString().trim();

    // Fallback: derive from pathname if params are missing in the runtime
    let raw = rawParam;
    if (!raw) {
      try {
        const u = new URL(_req.url);
        const parts = u.pathname.split("/").filter(Boolean);
        raw = (parts[parts.length - 1] ?? "").toString().trim();
      } catch {}
    }

    // Allow only a clean leading integer
    const m = /^(\d+)/.exec(raw);
    const id = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(id) || id <= 0) {
      return err("invalid_id", "id must be a positive number");
    }

    const row = await one<Row>(
      `
      SELECT id, filename, content_type, size_bytes, data
      FROM quote_attachments
      WHERE id = $1
      LIMIT 1;
      `,
      [id],
    );

    if (!row) {
      return err("not_found", `No attachment found for id=${id}`, 404);
    }

    if (row.filename === "forge_faces.json") {
      const faces = JSON.parse(row.data.toString("utf8"));

      const GRID = 0.125;
      const snap = (v: number) => Math.round(v / GRID) * GRID;

      const loops = faces.loops || [];
      if (!loops.length) {
        return NextResponse.json({ ok: false, error: "no_loops" }, { status: 422 });
      }

      // --- find outer loop (largest area) ---
      const area = (pts: any[]) => {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i],
            q = pts[(i + 1) % pts.length];
          a += p.x * q.y - q.x * p.y;
        }
        return Math.abs(a / 2);
      };

      loops.sort((a: any, b: any) => area(b.points) - area(a.points));
      const outer = loops[0].points;

      // --- normalize coords ---
      const minX = Math.min(...outer.map((p: any) => p.x));
      const minY = Math.min(...outer.map((p: any) => p.y));

      const norm = (pts: any[]) => pts.map((p: any) => ({ x: snap(p.x - minX), y: snap(p.y - minY) }));

      const outerN = norm(outer);

      const maxX = Math.max(...outerN.map((p: any) => p.x));
      const maxY = Math.max(...outerN.map((p: any) => p.y));

      const block = {
        width: snap(maxX),
        height: snap(maxY),
      };

      // --- cavities ---
      const cavities: any[] = [];

      for (let i = 1; i < loops.length; i++) {
        const pts = norm(loops[i].points);

        // rectangle detection
        if (pts.length === 4) {
          const xs = pts.map((p) => p.x),
            ys = pts.map((p) => p.y);
          cavities.push({
            shape: "rect",
            x: Math.min(...xs),
            y: Math.min(...ys),
            w: snap(Math.max(...xs) - Math.min(...xs)),
            h: snap(Math.max(...ys) - Math.min(...ys)),
          });
          continue;
        }

        // circle detection
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
        const avgR = rs.reduce((a, b) => a + b, 0) / rs.length;
        const dev = rs.reduce((a, b) => a + Math.abs(b - avgR), 0) / rs.length;

        if (dev < 0.02) {
          cavities.push({ shape: "circle", cx: snap(cx), cy: snap(cy), r: snap(avgR) });
          continue;
        }

        cavities.push({ shape: "poly", points: pts });
      }

      return NextResponse.json({
        ok: true,
        layout: {
          block,
          cavities,
        },
      });
    }

    const contentType = row.content_type || "application/octet-stream";
    const filename = row.filename || `attachment-${id}`;

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(row.size_bytes ?? row.data.length));
    headers.set("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
    headers.set("Cache-Control", "no-store");

    const body = new Uint8Array(row.data);
return new NextResponse(body, { status: 200, headers });

  } catch (e: any) {
    console.error("quote-attachments/[id] GET exception:", e);
    return err("attachment_get_exception", String(e?.message || e), 500);
  }
}
