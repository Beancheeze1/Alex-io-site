// lib/pdf/drawing-shop.ts
//
// Step 44: the shop's name for the title block of the 3-view PDF drawings
// (the tenant's brand name from its theme, else its name). Never throws: a
// drawing without the name falls back to "FOAM INSERT DRAWING".
// Step 44c: drawingRevisions(), the revision block's rows (the quote's saved
// layouts). Never throws: a drawing without history shows its current revision.

import { one, q } from "@/lib/db";
import { revisionRows, type DrawingRevision, type RevisionPackage, type RevisionUser } from "@/lib/pdf/drawing-revisions";
import { revisionNotesOf } from "@/lib/revision-notes";
import { loadFacts } from "@/app/lib/memory";

export async function drawingShopName(tenantId: number | string | null | undefined): Promise<string | undefined> {
  if (tenantId == null || tenantId === "") return undefined;
  try {
    const row = await one<{ name: string | null; theme_json: unknown }>(
      `SELECT name, theme_json FROM public.tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    if (!row) return undefined;
    const th = row.theme_json && typeof row.theme_json === "object" ? (row.theme_json as Record<string, unknown>) : {};
    const brand = typeof th.brandName === "string" ? th.brandName.trim() : "";
    const name = (brand || String(row.name || "").trim()).slice(0, 60);
    return name || undefined;
  } catch {
    return undefined;
  }
}

/** The quote's revisions for the drawing (oldest first); [] when anything goes wrong. */
export async function drawingRevisions(quoteId: number, quoteNo: string, tenantId: number | string): Promise<DrawingRevision[]> {
  try {
    const pkgs = await q<RevisionPackage>(
      `SELECT id, notes, created_at, created_by_user_id, layout_json
         FROM quote_layout_packages
        WHERE quote_id = $1
        ORDER BY created_at ASC, id ASC`,
      [quoteId],
    );
    const ids = Array.from(new Set(pkgs.map((p) => Number(p.created_by_user_id)).filter((n) => Number.isFinite(n) && n > 0)));
    const users = ids.length
      ? await q<RevisionUser>(`SELECT id, name, email FROM public."users" WHERE id = ANY($1::int[]) AND tenant_id = $2`, [ids, tenantId])
      : [];
    // Step 44d: descriptions / initials typed in the Revise box (never fatal)
    let notes = {};
    try {
      notes = revisionNotesOf(((await loadFacts(quoteNo)) || {}) as Record<string, unknown>);
    } catch {
      notes = {};
    }
    return revisionRows(pkgs, users, notes);
  } catch {
    return [];
  }
}
