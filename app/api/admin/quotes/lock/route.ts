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
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { quoteReviewFlags } from "@/app/lib/pricing/foam-quote";
import { approvalForQuote } from "@/app/lib/quote-approval";
import { sendQuoteStatusEmail } from "@/app/lib/quote-mail";
import { proofSummary } from "@/app/lib/proofs";
import { proofReleaseOk } from "@/app/lib/proofs-core";

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

function stripLeadingRevTags(raw: string | null): string | null {
  if (!raw) return null;
  let s = String(raw);

  // Remove one-or-more leading tokens like: [REV:X] [REV:Y] ...
  s = s.replace(/^(\s*(?:\[REV:[^\]]+\]\s*)+)+/i, "");

  s = s.trim();
  return s.length > 0 ? s : null;
}

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Step 29A: "your order is in production" to the buyer, once per release
 * (not on a re-lock of an already released quote). Staff can send
 * notify_buyer: false; the shop can turn it off in Settings. Never fails the release.
 */
async function emailReleased(quoteId: number, user: unknown, notify: unknown): Promise<string | null> {
  if (notify === false) return null;
  const u = (user || {}) as { name?: string | null; email?: string | null };
  const r = await sendQuoteStatusEmail({ quoteId, kind: "released", by: String(u.name || u.email || "staff") });
  return r.status;
}

/**
 * Step 16: a boxes-only quote has boxes but no foam layout, so there is no
 * layout package / CAD to freeze. Boxes-only = facts.pack_type "boxes_only",
 * or no foam lines and at least one box.
 */
async function boxesOnlyInfo(quoteId: number, quoteNo: string): Promise<{ boxesOnly: boolean; boxes: number }> {
  const counts = await one<{ items: number; boxes: number }>(
    `
    select
      (select count(*) from quote_items where quote_id = $1)::int as items,
      (select count(*) from quote_box_selections where quote_id = $1)::int as boxes
    `,
    [quoteId],
  );
  const items = Number(counts?.items) || 0;
  const boxes = Number(counts?.boxes) || 0;
  let packType = "";
  try {
    const facts = ((await loadFacts(quoteNo)) || {}) as { pack_type?: unknown };
    packType = String(facts.pack_type || "");
  } catch {
    // non-fatal
  }
  return { boxesOnly: packType === "boxes_only" || (items === 0 && boxes > 0), boxes };
}

/** Released revision mint (Path A): A, then B, C… on each release. Non-fatal. */
async function mintReleasedRev(quoteNo: string): Promise<void> {
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
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req as any);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return json(enforced.body, enforced.status);
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
      and tenant_id = $2
    `,
    [quoteNo, user.tenant_id],
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
        and tenant_id = $2
      `,
      [quote.id, user.tenant_id],
    );

    // Step 16: boxes-only quotes have no layout editor; the caller opens the quote page.
    const info = await boxesOnlyInfo(quote.id, quote.quote_no);
    return json({ ok: true, locked: false, boxes_only: info.boxesOnly });
  }

  // Step 25: release only once staff have seen the review flags. The caller
  // shows them and, if staff confirm, sends the release again with ack_flags.
  if (!quote.locked && body?.ack_flags !== true) {
    const flags = await quoteReviewFlags(quote.id, quote.quote_no, Number(user.tenant_id));
    if (flags.length > 0) {
      return json(
        {
          ok: false,
          error: "REVIEW_FLAGS",
          message: `This quote has ${flags.length} thing${flags.length > 1 ? "s" : ""} to check before release.`,
          flags,
        },
        409,
      );
    }
  }

  // Step 28: release normally follows the shop's confirmation. An unconfirmed
  // quote is refused until staff say to release it anyway (ack_unconfirmed).
  if (!quote.locked && body?.ack_unconfirmed !== true) {
    const approval = await approvalForQuote({ id: quote.id, quote_no: quote.quote_no, tenant_id: Number(user.tenant_id) });
    if (approval && approval.stage !== "confirmed") {
      return json(
        {
          ok: false,
          error: "NOT_CONFIRMED",
          message:
            approval.stage === "accepted"
              ? "The buyer accepted this quote but the shop hasn't confirmed it yet."
              : approval.stage === "needs_reapproval"
                ? "The price changed since the buyer accepted: it needs their re-approval and your confirmation."
                : "This quote hasn't been accepted by the buyer or confirmed by the shop.",
          stage: approval.stage,
        },
        409,
      );
    }
  }

  // Step 31: a printed quote normally has an approved proof first. Refused
  // until staff say to release it anyway (ack_proof).
  if (!quote.locked && body?.ack_proof !== true) {
    const proofs = await proofSummary({ id: quote.id, quote_no: quote.quote_no });
    if (!proofReleaseOk(proofs.required, proofs.stage)) {
      return json(
        {
          ok: false,
          error: "PROOF_NOT_APPROVED",
          message:
            proofs.stage === "none"
              ? "This quote prints, and no proof has been sent to the buyer."
              : proofs.stage === "changes"
                ? `The buyer asked for changes to proof v${proofs.latest_version}.`
                : `Proof v${proofs.latest_version} hasn't been approved by the buyer yet.`,
          stage: proofs.stage,
        },
        409,
      );
    }
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
    // Step 16: boxes-only quotes have no foam layout or CAD. Release = lock the
    // quote (prices and boxes freeze) and mint the released revision.
    const info = await boxesOnlyInfo(quote.id, quote.quote_no);
    if (info.boxesOnly && info.boxes > 0) {
      if (!quote.locked) {
        await q(
          `
          update quotes
          set locked = true,
              geometry_hash = null,
              locked_at = now(),
              updated_by_user_id = $2
          where id = $1
            and tenant_id = $3
          `,
          [quote.id, user.id, user.tenant_id],
        );
        await mintReleasedRev(quoteNo);
        const email = await emailReleased(quote.id, user, body?.notify_buyer);
        return json({ ok: true, locked: true, boxes_only: true, geometry_hash: null, release_pkg_id: null, email });
      }
      return json({ ok: true, locked: true, boxes_only: true, geometry_hash: null, release_pkg_id: null });
    }
    return json(
      {
        ok: false,
        error: "LAYOUT_NOT_FOUND",
        message: info.boxesOnly
          ? "This quote has no boxes yet. Add a box before releasing it."
          : "No layout package found for this quote.",
      },
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

    const humanNotes = stripLeadingRevTags(pkg.notes);
    let notesForRelease: string;
    if (humanNotes) {
      notesForRelease = `[REV:${currentRevision}] ${humanNotes}`;
    } else {
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
  await mintReleasedRev(quoteNo);
  // --- END RELEASED REV MINT ---

  // Step 29A: the buyer hears it's in production (first release only).
  const email = quote.locked ? null : await emailReleased(quote.id, user, body?.notify_buyer);

  return json({ ok: true, locked: true, geometry_hash: hash, release_pkg_id: result.release_pkg_id, email });
}
