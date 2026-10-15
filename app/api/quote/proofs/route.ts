// app/api/quote/proofs/route.ts
//
// Step 31: artwork proofs, buyer side (rules in app/lib/proofs-core.ts).
//   GET  ?quote_no=Q-...  -> { ok, locked, required, stage, latest_version, versions }
//        The quote number is the credential, like artwork (rate limited).
//   POST multipart: quote_no, version, action ("approve" | "changes"),
//        name, agree, comment, file (optional marked-up file)
//        -> { ok, ...summary }
//        Needs the buyer's edit link, or staff of the quote's shop (staff
//        record the buyer's answer for them: response_by_staff). Only the
//        newest proof, while it's waiting, on an unreleased quote.
//        The shop gets a "Proof" alert.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { buyerEditGuard, isQuoteStaff } from "@/lib/quote-edit";
import { addAdminAlert } from "@/lib/admin-alerts";
import { formFile, loadProofs, proofSummary, saveProofFile } from "@/app/lib/proofs";
import { MAX_PROOF_COMMENT, canRespondToProof, cleanProofText, proofResponseProblem } from "@/app/lib/proofs-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = { id: number; quote_no: string; tenant_id: number; locked: boolean | null };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

async function findQuote(quoteNo: string): Promise<QuoteRow | null> {
  if (!quoteNo) return null;
  return one<QuoteRow>(`SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`, [quoteNo]);
}

export async function GET(req: NextRequest) {
  try {
    const quoteNo = (req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    const quote = await findQuote(quoteNo);
    if (!quote) return bad("not_found", "Quote not found.", 404);
    if (!(await isQuoteStaff(req, quote.tenant_id))) {
      const rate = await rateLimit(req, 60, "proofs-get");
      if (!rate.success) return rateLimitResponse(rate.reset);
    }
    return json({ ok: true, locked: !!quote.locked, ...(await proofSummary(quote)) });
  } catch (e) {
    console.error("[quote/proofs] GET failed:", e);
    return bad("server_error", "We couldn't load the proofs.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > 9 * 1024 * 1024) return bad("invalid_file", "That file is too large. Files can be up to 8 MB.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return bad("invalid_body", "Send the answer as a form.");
    }
    const quoteNo = String(form.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    const quote = await findQuote(quoteNo);
    if (!quote) return bad("not_found", "Quote not found.", 404);

    const guard = await buyerEditGuard(req, quote, {
      rateName: "proofs-respond",
      perMin: 10,
      lockedMessage: "This quote has been released. Contact the shop about the proof.",
    });
    if (guard) return guard;
    const staff = await isQuoteStaff(req, quote.tenant_id);

    const version = Number(form.get("version"));
    const action = String(form.get("action") || "");
    const name = form.get("name");
    const comment = form.get("comment");
    const agree = String(form.get("agree") || "");
    const problem = proofResponseProblem({ action, name, comment, agree });
    if (problem) return bad("invalid_answer", problem);

    const rows = await loadProofs(quote.id, quote.quote_no);
    if (!canRespondToProof(rows, version, !!quote.locked)) {
      return bad("not_answerable", "This proof can't be answered: there's a newer one, or it already has an answer.", 409);
    }

    let markupId: number | null = null;
    const file = action === "changes" ? formFile(form, "file") : null;
    if (file) {
      const saved = await saveProofFile(quote, file, "proof_markup");
      if ("problem" in saved) return bad("invalid_file", saved.problem);
      markupId = saved.id;
    }

    const cleanName = cleanProofText(name, 120);
    await q(
      `UPDATE public.quote_proofs
          SET status = $3, response_at = now(), response_name = $4, response_comment = $5,
              response_attachment_id = $6, response_by_staff = $7
        WHERE quote_id = $1 AND version = $2`,
      [
        quote.id,
        version,
        action === "approve" ? "approved" : "changes",
        cleanName,
        cleanProofText(comment, MAX_PROOF_COMMENT),
        markupId,
        staff,
      ],
    );

    await addAdminAlert({
      req,
      tenantId: Number(quote.tenant_id),
      quoteNo: quote.quote_no,
      kind: "proof",
      title: action === "approve" ? `Proof v${version} approved` : `Changes requested on proof v${version}`,
      detail:
        action === "approve"
          ? `${cleanName || "The buyer"} approved the proof.`
          : `${(cleanProofText(comment, 200) || "").slice(0, 200)}${markupId ? " (marked-up file attached)" : ""}`,
    });

    return json({ ok: true, locked: !!quote.locked, ...(await proofSummary(quote)) });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42P01") return bad("not_migrated", "Proofs aren't set up yet (migration 043).", 503);
    console.error("[quote/proofs] POST failed:", e);
    return bad("server_error", "We couldn't save your answer. Please try again.", 500);
  }
}
