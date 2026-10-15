// app/api/admin/quotes/proofs/route.ts
//
// Step 31: the shop sends a proof (rules in app/lib/proofs-core.ts).
//   POST multipart: quote_no, file, note?, notify ("false" = don't email)
//     -> { ok, ...summary, email? }
//   Adds the next version (v1, v2, ...); every earlier version becomes
//   "superseded" (an approval doesn't carry over to a new proof). Emails the
//   buyer "your proof is ready" unless notify is "false".
// Staff (admin / cs / sales) of the quote's shop, or the platform owner.

import { NextRequest, NextResponse } from "next/server";
import { one, withTxn } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { formFile, loadProofs, proofSummary, saveProofFile } from "@/app/lib/proofs";
import { MAX_PROOF_NOTE, cleanProofText, nextProofVersion } from "@/app/lib/proofs-core";
import { sendQuoteStatusEmail } from "@/app/lib/quote-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return bad("unauthorized", "Login required.", 401);
    if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return bad("forbidden", "Staff only.", 403);

    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > 9 * 1024 * 1024) return bad("invalid_file", "That file is too large. Files can be up to 8 MB.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return bad("invalid_body", "Send the proof as a form upload.");
    }
    const quoteNo = String(form.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    const quote = await one<{ id: number; quote_no: string; tenant_id: number; locked: boolean | null }>(
      `SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!quote || (Number(quote.tenant_id) !== Number(user.tenant_id) && !isPlatformOwner(user))) {
      return bad("not_found", "Quote not found.", 404);
    }
    if (quote.locked) return bad("locked", "This quote has been released. Unlock it to send a new proof.", 409);

    const file = formFile(form, "file");
    if (!file) return bad("missing_file", "Choose the proof file.");
    const saved = await saveProofFile(quote, file, "proof");
    if ("problem" in saved) return bad("invalid_file", saved.problem);

    const note = cleanProofText(form.get("note"), MAX_PROOF_NOTE);
    const who = String((user as { name?: string | null }).name || user.email || "staff").slice(0, 120);
    const version = await withTxn(async (tx) => {
      const existing = await loadProofs(quote.id, quote.quote_no);
      const v = nextProofVersion(existing);
      await tx.query(`UPDATE public.quote_proofs SET status = 'superseded' WHERE quote_id = $1 AND version < $2`, [quote.id, v]);
      await tx.query(
        `INSERT INTO public.quote_proofs (quote_id, tenant_id, version, attachment_id, note, status, sent_by)
         VALUES ($1, $2, $3, $4, $5, 'sent', $6)`,
        [quote.id, quote.tenant_id, v, saved.id, note, who],
      );
      return v;
    });

    let email: { status: string; detail: string | null } | null = null;
    if (String(form.get("notify") || "") !== "false") {
      const r = await sendQuoteStatusEmail({
        quoteId: quote.id,
        kind: "proof",
        by: who,
        proofVersion: version,
        proofNote: note,
        logDetail: `v${version}`,
      });
      email = { status: r.status, detail: r.detail };
    }

    return json({ ok: true, version, locked: false, ...(await proofSummary(quote)), email });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42P01") return bad("not_migrated", "Proofs aren't set up yet (migration 043).", 503);
    console.error("[admin/quotes/proofs] POST failed:", e);
    return bad("server_error", "Couldn't save the proof. Please try again.", 500);
  }
}
