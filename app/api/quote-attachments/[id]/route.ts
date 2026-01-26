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
      let faces: any = null;
      try {
        faces = JSON.parse(row.data.toString("utf8"));
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, error: "forge_faces_parse_failed", detail: String(e?.message || e) },
          { status: 400 },
        );
      }

      const unitsRaw = String(faces?.units || "").trim().toLowerCase();
      const toIn = (v: number) => (unitsRaw === "mm" ? v / 25.4 : v);

      const rawLoops = Array.isArray(faces?.loops) ? faces.loops : [];
      const loops = rawLoops
        .map((loop: any) => {
          const pts = Array.isArray(loop?.points) ? loop.points : [];
          const clean = pts
            .map((p: any) => ({ x: toIn(Number(p?.x)), y: toIn(Number(p?.y)) }))
            .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
          return clean.length >= 3 ? clean : [];
        })
        .filter((pts: any[]) => pts.length >= 3);

      if (!loops.length) {
        return NextResponse.json({ ok: false, error: "no_loops" }, { status: 400 });
      }

      const areaSigned = (pts: any[]) => {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const q = pts[(i + 1) % pts.length];
          a += p.x * q.y - q.x * p.y;
        }
        return a / 2;
      };

      let outerIdx = 0;
      let maxArea = 0;
      for (let i = 0; i < loops.length; i++) {
        const a = Math.abs(areaSigned(loops[i]));
        if (a > maxArea) {
          maxArea = a;
          outerIdx = i;
        }
      }

      const outer = loops[outerIdx];
      let minX = Infinity;
      let minY = Infinity;
      for (const p of outer) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        return NextResponse.json({ ok: false, error: "invalid_outer_loop" }, { status: 400 });
      }

      const GRID = 0.125;
      const snap = (v: number) => Math.round(v / GRID) * GRID;

      const translate = (pts: any[]) => pts.map((p: any) => ({ x: p.x - minX, y: p.y - minY }));
      const translateAndSnap = (pts: any[]) =>
        pts.map((p: any) => ({ x: snap(p.x - minX), y: snap(p.y - minY) }));

      const outerTranslated = translate(outer);
      const outerSnapped = translateAndSnap(outer);

      let maxX = -Infinity;
      let maxY = -Infinity;
      let minTX = Infinity;
      let minTY = Infinity;
      for (const p of outerTranslated) {
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        if (p.x < minTX) minTX = p.x;
        if (p.y < minTY) minTY = p.y;
      }

      const blockWidth = snap(maxX - minTX);
      const blockHeight = snap(maxY - minTY);

      const tol = 1e-3;
      const isAxisAlignedRect = (pts: any[]) => {
        let lx = Infinity,
          ly = Infinity,
          hx = -Infinity,
          hy = -Infinity;
        for (const p of pts) {
          if (p.x < lx) lx = p.x;
          if (p.y < ly) ly = p.y;
          if (p.x > hx) hx = p.x;
          if (p.y > hy) hy = p.y;
        }

        const corners: any[] = [];
        for (const p of pts) {
          const onX = Math.abs(p.x - lx) <= tol || Math.abs(p.x - hx) <= tol;
          const onY = Math.abs(p.y - ly) <= tol || Math.abs(p.y - hy) <= tol;
          if (!onX || !onY) return false;
          const exists = corners.some(
            (c) => Math.abs(c.x - p.x) <= tol && Math.abs(c.y - p.y) <= tol,
          );
          if (!exists) corners.push(p);
        }

        return corners.length === 4;
      };

      const blockIsRect = isAxisAlignedRect(outerTranslated);
      const block: any = {
        width: blockWidth,
        height: blockHeight,
        shape: blockIsRect ? "rectangle" : "polygon",
      };

      if (!blockIsRect) {
        const points =
          outerSnapped.length > 1 &&
          outerSnapped[0].x === outerSnapped[outerSnapped.length - 1].x &&
          outerSnapped[0].y === outerSnapped[outerSnapped.length - 1].y
            ? outerSnapped.slice(0, -1)
            : outerSnapped;
        block.points = points.map((p: any) => ({ x: p.x, y: p.y }));
      }

      const cavities: any[] = [];

      const isCircle = (pts: any[]) => {
        if (pts.length < 8) return null;
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        const rs = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
        const avgR = rs.reduce((a, b) => a + b, 0) / rs.length;
        const dev = rs.reduce((a, b) => a + Math.abs(b - avgR), 0) / rs.length;
        if (avgR > 0 && dev < 0.02) {
          return { cx, cy, r: avgR };
        }
        return null;
      };

      for (let i = 0; i < loops.length; i++) {
        if (i === outerIdx) continue;

        const holeTranslated = translate(loops[i]);
        const holeSnapped = translateAndSnap(loops[i]);

        if (isAxisAlignedRect(holeTranslated)) {
          let lx = Infinity,
            ly = Infinity,
            hx = -Infinity,
            hy = -Infinity;
          for (const p of holeTranslated) {
            if (p.x < lx) lx = p.x;
            if (p.y < ly) ly = p.y;
            if (p.x > hx) hx = p.x;
            if (p.y > hy) hy = p.y;
          }
          cavities.push({
            type: "rectangle",
            x: snap(lx),
            y: snap(ly),
            w: snap(hx - lx),
            h: snap(hy - ly),
          });
          continue;
        }

        const circle = isCircle(holeTranslated);
        if (circle) {
          cavities.push({
            type: "circle",
            x: snap(circle.cx),
            y: snap(circle.cy),
            r: snap(circle.r),
          });
          continue;
        }

        const points =
          holeSnapped.length > 1 &&
          holeSnapped[0].x === holeSnapped[holeSnapped.length - 1].x &&
          holeSnapped[0].y === holeSnapped[holeSnapped.length - 1].y
            ? holeSnapped.slice(0, -1)
            : holeSnapped;
        cavities.push({
          type: "polygon",
          points: points.map((p: any) => ({ x: p.x, y: p.y })),
        });
      }

      return NextResponse.json(
        {
          block,
          cavities,
        },
        { status: 200 },
      );
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
