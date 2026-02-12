import { NextRequest, NextResponse } from "next/server";
import { one, q, withTxn } from "@/lib/db";
import {
  buildLayoutExports,
  computeGeometryHash,
  embedGeometryHashInDxf,
  embedGeometryHashInStep,
  embedGeometryHashInSvg,
} from "@/app/lib/layout/exports";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { buildStepFromLayout } from "@/lib/cad/step";
import { loadFacts, saveFacts } from "@/app/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = {
  id: number;
  quote_no: string;
  locked?: boolean | null;
  geometry_hash?: string | null;
};

type LayoutPkgRow = {
  id: number;
  quote_id: number;
  layout_json: any;
  notes: string | null;
  svg_text: string | null;
  dxf_text: string | null;
  step_text: string | null;
  created_at: string;
};

function normalizeRevLabel(s?: string | null): string {
  const t = String(s || "").trim();
  if (!t) return "";
  return t.toLowerCase().startsWith("rev") ? t.slice(3).trim() : t;
}

function nextReleasedLetter(cur?: string | null): string {
  const t = normalizeRevLabel(cur);
  if (!t) return "A";
  const c = t.trim().charAt(0).toUpperCase();
  const code = c.charCodeAt(0);
  if (code < 65 || code > 90) return "A";
  return String.fromCharCode(code + 1);
}

function nextStageRev(cur?: string | null): string {
  const t = normalizeRevLabel(cur);
  // Expect "AS", "BS", ...
  if (!t || t.length < 2) return "AS";
  const letter = t.charAt(0).toUpperCase();
  const code = letter.charCodeAt(0);
  if (code < 65 || code > 90) return "AS";
  return String.fromCharCode(code + 1) + "S";
}

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req as any);
  const role = (user?.role || "").toLowerCase();
  const isAdmin = role === "admin";

  if (!user) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);
  if (!isAdmin)
    return json({ ok: false, error: "FORBIDDEN", message: "Admin access required." }, 403);

  const body = (await req.json().catch(() => null)) as any;
  const quoteNo = typeof body?.quoteNo === "string" ? body.quoteNo.trim() : "";
  const lock = !!body?.lock;

  if (!quoteNo) {
    return json({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
  }

  const quote = await one<QuoteRow>(
    `
    select id, quote_no, locked, geometry_hash
    from quotes
    where quote_no = $1
    `,
    [quoteNo],
  );

  if (!quote) {
    return json({ ok: false, error: "NOT_FOUND", message: "Quote not found." }, 404);
  }

  // UNLOCK (admin only) � leaves packages intact, simply removes the lock gate + stored hash.
  // IMPORTANT: Unlock must NOT bump staging revisions. Revise is the only flow that arms a bump.
  if (!lock) {
    await q(
      `
      update quotes
      set locked = false,
          locked_at = null,
          geometry_hash = null
      where id = $1
      `,
      [quote.id],
    );

    return json({ ok: true, locked: false });
  }

  // Load the latest package as the staging source we are about to freeze.
  const pkg = await one<LayoutPkgRow>(
    `
    select
      id,
      quote_id,
      layout_json,
      notes,
      svg_text,
      dxf_text,
      step_text,
      created_at
    from quote_layout_packages
    where quote_id = $1
    order by created_at desc, id desc
    limit 1
    `,
    [quote.id],
  );

  if (!pkg?.layout_json) {
    return json(
      { ok: false, error: "LAYOUT_NOT_FOUND", message: "No layout package found for this quote." },
      404,
    );
  }

  // Compute the geometry hash from the staging layout we're about to release.
  const hash = computeGeometryHash(pkg.layout_json);
  const storedHash = typeof quote.geometry_hash === "string" ? quote.geometry_hash : "";

  // If already locked, do not allow re-locking if geometry changed.
  if (quote.locked && storedHash && storedHash !== hash) {
    return json(
      {
        ok: false,
        error: "GEOMETRY_HASH_MISMATCH",
        message: "Stored hash differs from current layout.",
      },
      409,
    );
  }

  // Build a canonical export set for this release snapshot.
  // Prefer the already-saved exports when present; otherwise, generate minimal exports.
  const bundle = buildLayoutExports(pkg.layout_json);

  const svgBase =
    pkg.svg_text && pkg.svg_text.trim().length > 0 ? pkg.svg_text : bundle.svg;
  const dxfBase =
    pkg.dxf_text && pkg.dxf_text.trim().length > 0 ? pkg.dxf_text : bundle.dxf;

  // STEP is the only exporter that may require external service.
  // If missing, generate it now � release is atomic; if STEP fails, release fails.
  let stepBase =
    pkg.step_text && pkg.step_text.trim().length > 0 ? pkg.step_text : null;
  if (!stepBase) {
    stepBase = await buildStepFromLayout(pkg.layout_json, quoteNo, "");
  }

  const svgText = embedGeometryHashInSvg(svgBase ?? "", hash);
  const dxfText = embedGeometryHashInDxf(dxfBase ?? "", hash);
  const stepText = embedGeometryHashInStep(stepBase ?? "", hash);

  if (!stepText || stepText.trim().length === 0) {
    return json(
      { ok: false, error: "STEP_NOT_AVAILABLE", message: "Unable to generate STEP for release." },
      500,
    );
  }

  // Atomic release:
  // - Verify the staging package did not change
  // - Insert a new package row that represents the released (frozen) snapshot
  // - Lock the quote + store geometry_hash
  const result = await withTxn(async (tx) => {
    const latest = await tx.query<Pick<LayoutPkgRow, "id" | "layout_json">>(
      `
      select id, layout_json
      from quote_layout_packages
      where quote_id = $1
      order by created_at desc, id desc
      limit 1
      `,
      [quote.id],
    );

    const latestRow = (latest.rows?.[0] as any) || null;
    if (!latestRow?.layout_json || latestRow.id !== pkg.id) {
      throw Object.assign(new Error("LAYOUT_CHANGED_DURING_RELEASE"), {
        code: "LAYOUT_CHANGED_DURING_RELEASE",
      });
    }

    const latestHash = computeGeometryHash(latestRow.layout_json);
    if (latestHash !== hash) {
      throw Object.assign(new Error("GEOMETRY_CHANGED_DURING_RELEASE"), {
        code: "GEOMETRY_CHANGED_DURING_RELEASE",
      });
    }

    // Load current revision for package tagging
    let currentRevision = "A";
    try {
      const facts: any = await loadFacts(quoteNo);
      currentRevision = facts?.released_rev || facts?.revision || "A";
    } catch {
      // Non-fatal: use default
    }

    // Tag the release package with revision
    // If the package already has notes with revision, preserve them
    // Otherwise, add the revision tag
    let notesForRelease = pkg.notes ?? null;
    if (notesForRelease && !notesForRelease.startsWith("[REV:")) {
      notesForRelease = `[REV:${currentRevision}] ${notesForRelease}`;
    } else if (!notesForRelease) {
      notesForRelease = `[REV:${currentRevision}] RELEASED`;
    }

    // Insert a RELEASE snapshot as a new package row so exports are immutable post-lock.
    const inserted = await tx.query<{ id: number }>(
      `
      insert into quote_layout_packages (
        quote_id,
        layout_json,
        notes,
        svg_text,
        dxf_text,
        step_text,
        created_by_user_id,
        updated_by_user_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $7)
      returning id
      `,
      [quote.id, pkg.layout_json, notesForRelease, svgText, dxfText, stepText, user.id],
    );

    await tx.query(
      `
      update quotes
      set locked = true,
          geometry_hash = $2,
          locked_at = now(),
          updated_by_user_id = $3
      where id = $1
      `,
      [quote.id, hash, user.id],
    );

    return { release_pkg_id: inserted.rows?.[0]?.id ?? null };
  });

  // --- RELEASED REV MINT (Path A) ---
  try {
    const facts: any = await loadFacts(quoteNo);
    const curReleased = facts?.released_rev || "";
    const nextReleased = nextReleasedLetter(curReleased);
    facts.released_rev = nextReleased;
    facts.revision = nextReleased; // locked displays released
    if (!facts.stage_rev) {
      // Ensure staging exists for the chain, but do not advance it here.
      const cur = facts?.revision || "";
      facts.stage_rev = normalizeRevLabel(cur).endsWith("S") ? normalizeRevLabel(cur) : "AS";
    }
    facts.released_from_stage = facts.stage_rev || null;
    await saveFacts(quoteNo, facts);
  } catch {
    // non-fatal
  }
  // --- END RELEASED REV MINT ---

  return json({ ok: true, locked: true, geometry_hash: hash, release_pkg_id: result.release_pkg_id });
}