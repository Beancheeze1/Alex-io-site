// lib/pdf/drawing-revisions.ts
//
// Step 44c: the revision block on the 3-view PDF drawings. Each saved layout
// (quote_layout_packages: Apply and Release both save one, tagged
// "[REV:AS]", "[REV:A]" …) is one revision. A revision shows its letter, a
// short description worked out from what changed since the revision before
// (size, layers, pockets, released), the initials of the person who saved it
// and the date. Pure (no database), so the tests can run it; the database read
// is drawingRevisions() in lib/pdf/drawing-shop.ts.
// Step 44d: a description and initials typed in the Revise box (facts
// rev_notes, lib/revision-notes.ts) take the place of the worked-out ones;
// a release still adds "Released".

import { fmtIn } from "@/lib/pdf/threeview";
import { initialsOf, type RevisionNotes } from "@/lib/revision-notes";

export type DrawingRevision = { rev: string; description: string; by: string; date: string };

export type RevisionPackage = {
  id: number;
  notes: string | null;
  created_at: string | Date | null;
  created_by_user_id: number | null;
  layout_json: unknown;
};

export type RevisionUser = { id: number; name: string | null; email: string | null };

export { initialsOf };

function revOf(notes: string | null): string | null {
  const m = String(notes || "").match(/^\s*\[REV:([^\]]+)\]/i);
  return m ? m[1].trim().slice(0, 4) : null;
}

const r4 = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : null;
};

type Shape = { size: string; layers: number; pockets: number; geom: string };
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

/** The parts of a saved layout the revision block compares. */
function shapeOf(layoutRaw: unknown): Shape {
  const layout = obj(layoutRaw);
  const block = obj(layout.block);
  const stack: Obj[] =
    Array.isArray(layout.stack) && layout.stack.length ? layout.stack.map(obj) : [{ cavities: Array.isArray(layout.cavities) ? layout.cavities : [] }];
  const L = r4(block.lengthIn ?? block.length_in);
  const W = r4(block.widthIn ?? block.width_in);
  const T = stack.length > 1 ? r4(stack.reduce((s, l) => s + (Number(l.thicknessIn ?? l.thickness_in) || 0), 0)) : r4(block.thicknessIn ?? block.heightIn ?? block.thickness_in);
  const cavs: Obj[][] = stack.map((l) => (Array.isArray(l.cavities) ? l.cavities.map(obj) : []));
  const geom = JSON.stringify({
    t: stack.map((l) => r4(l.thicknessIn ?? l.thickness_in)),
    corners: stack.map((l) => [!!(l.cropCorners ?? l.crop_corners), !!(l.roundCorners ?? l.round_corners)]),
    c: cavs.map((list) =>
      list.map((c) => [
        String(c.shape || "rect").toLowerCase(),
        r4(c.x),
        r4(c.y),
        r4(c.lengthIn ?? c.length_in),
        r4(c.widthIn ?? c.width_in),
        r4(c.depthIn ?? c.depth_in),
        r4(c.diameterIn ?? c.diameter_in),
        r4(c.cornerRadiusIn ?? c.corner_radius_in),
        Array.isArray(c.points) ? c.points.length : 0,
      ]),
    ),
  });
  return {
    size: [L, W, T].map((v) => (v == null ? "?" : fmtIn(v))).join(" \xD7 "),
    layers: stack.length,
    pockets: cavs.reduce((s, l) => s + l.length, 0),
    geom,
  };
}

function describe(prev: Shape | null, cur: Shape, released: boolean): string {
  if (!prev) return released ? "Initial layout, released" : "Initial layout";
  const parts: string[] = [];
  if (prev.size !== cur.size) parts.push(`Size ${cur.size}`);
  if (prev.layers !== cur.layers) parts.push(`Layers ${prev.layers} to ${cur.layers}`);
  if (prev.pockets !== cur.pockets) parts.push(`Pockets ${prev.pockets} to ${cur.pockets}`);
  if (!parts.length && prev.geom !== cur.geom) parts.push("Pockets or parts changed");
  if (released) parts.push("Released");
  return parts.length ? parts.join("; ") : "No geometry change";
}

function dateOf(v: string | Date | null): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * Step 44e: a released quote whose release snapshot isn't in the history (quotes
 * released before Step 44e tagged it with the staging letter) gets its released
 * letter as the last row, so the drawing and its title block show it.
 */
export function withReleasedRow(rows: DrawingRevision[], current: string | null | undefined, lockedAt?: string | Date | null): DrawingRevision[] {
  const rev = String(current || "").trim().toUpperCase();
  if (!rev || /S$/.test(rev) || rows.some((r) => r.rev === rev)) return rows;
  return [...rows, { rev, description: "Released", by: "", date: dateOf(lockedAt ?? null) }];
}

/**
 * One row per revision letter, oldest first. Saves that share a letter are one
 * revision (its last save); its description compares with the revision before.
 * A letter without a trailing "S" (A, B …) is a release.
 */
export function revisionRows(pkgs: RevisionPackage[], users: RevisionUser[], notes: RevisionNotes = {}): DrawingRevision[] {
  const byUser = new Map(users.map((u) => [Number(u.id), u]));
  const groups: { rev: string; last: RevisionPackage }[] = [];
  let lastRev = "AS";
  for (const p of pkgs) {
    const rev = revOf(p.notes) ?? lastRev;
    lastRev = rev;
    const g = groups[groups.length - 1];
    if (g && g.rev === rev) g.last = p;
    else groups.push({ rev, last: p });
  }
  let prev: Shape | null = null;
  return groups.map((g) => {
    const cur = shapeOf(g.last.layout_json);
    const released = !/S$/i.test(g.rev);
    const typed = notes[g.rev.toUpperCase()];
    const row = {
      rev: g.rev.toUpperCase(),
      description: typed?.description ? (released ? `${typed.description}; Released` : typed.description) : describe(prev, cur, released),
      by: typed?.by || initialsOf(byUser.get(Number(g.last.created_by_user_id))),
      date: dateOf(g.last.created_at),
    };
    prev = cur;
    return row;
  });
}
