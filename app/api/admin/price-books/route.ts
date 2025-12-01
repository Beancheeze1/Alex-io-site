// app/api/admin/price-books/route.ts
//
// Read-only list of price books for the admin UI.
// URL: /api/admin/price-books
//
// Does NOT touch pricing math. Only surfaces metadata from price_books.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PriceBookRow = {
  id: number;
  name: string;
  version: string;
  currency: string;
  created_at: string;
  notes: string | null;
};

function ok(extra: Record<string, any> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...extra }, { status });
}

function bad(
  code: string,
  extra: Record<string, any> = {},
  status = 500,
) {
  return NextResponse.json(
    { ok: false, error: code, ...extra },
    { status },
  );
}

export async function GET(_req: NextRequest) {
  try {
    const rows = await q<PriceBookRow>(
      `
      SELECT
        id,
        name,
        version,
        currency,
        created_at,
        notes
      FROM price_books
      ORDER BY created_at DESC, id DESC;
      `,
      [],
    );

    const priceBooks = rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      currency: r.currency,
      created_at: r.created_at,
      notes: r.notes,
      // For now, all are treated as "Active" until/unless you add an is_active flag.
      isActive: true,
      // Scope / breaks are derived from notes or left generic.
      scope: r.notes && r.notes.trim().length > 0
        ? r.notes
        : "General price book",
      breaks: "Configured in pricing engine",
    }));

    const total = priceBooks.length;
    const active = priceBooks.filter((pb) => pb.isActive).length;
    const archived = total - active;

    return ok({
      priceBooks,
      stats: {
        total,
        active,
        archived,
      },
    });
  } catch (err: any) {
    console.error("admin price-books GET error:", err);
    return bad("price_books_exception", {
      message: String(err?.message || err),
    });
  }
}
