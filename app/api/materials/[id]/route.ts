// app/api/materials/[id]/route.ts
//
// Public, read-only material lookup: GET /api/materials/{id}
// Returns only non-sensitive fields (name, family, density). No pricing.
//
// Oct 2026: removed the PATCH and DELETE handlers. They had no auth check
// and nothing in the app used them. Material edits go through
// /api/admin/materials (admin only).

import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await ctx.params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
    }

    const row = await one<{
      id: number;
      name: string;
      material_family: string | null;
      density_lb_ft3: string | null;
    }>(
      `
      SELECT id, name, material_family, density_lb_ft3
      FROM public.materials
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );

    if (!row) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, material: row }, { status: 200 });
  } catch (e: any) {
    console.error("[materials/[id]] GET failed:", e);
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  }
}
