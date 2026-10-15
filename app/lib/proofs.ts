// app/lib/proofs.ts
//
// Step 31: artwork proofs on a quote (rules in app/lib/proofs-core.ts).
//   - loadProofs(quoteId, quoteNo): every version, newest first, with its file
//     link and the buyer's answer (empty before migration 043)
//   - quotePrinted(quoteId, quoteNo): does the quote print (proof required)
//   - proofSummary(quote): required / stage / versions, for the pages and
//     for release
//   - saveProofFile(): stores a proof (or a buyer's marked-up file) in
//     quote_attachments; the same file types and size as artwork
// Files download through /api/quote-attachments/{id}?quote_no=, like artwork.

import { one, q } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { ARTWORK_CONTENT_TYPES, artworkExt, artworkProblem } from "@/lib/artwork";
import { factsPrinted, proofStage, type ProofStage, type ProofStatus } from "@/app/lib/proofs-core";

export type ProofFile = { id: number; filename: string; content_type: string | null; url: string };

export type ProofOut = {
  version: number;
  status: ProofStatus;
  note: string | null;
  sent_at: string;
  sent_by: string | null;
  file: ProofFile | null;
  response: {
    at: string;
    name: string | null;
    comment: string | null;
    by_staff: boolean;
    file: ProofFile | null;
  } | null;
};

export type ProofSummary = {
  required: boolean;
  stage: ProofStage;
  latest_version: number | null;
  versions: ProofOut[];
};

type Row = {
  version: number;
  status: ProofStatus;
  note: string | null;
  sent_at: unknown;
  sent_by: string | null;
  attachment_id: number;
  file_name: string | null;
  file_type: string | null;
  response_at: unknown;
  response_name: string | null;
  response_comment: string | null;
  response_by_staff: boolean | null;
  response_attachment_id: number | null;
  markup_name: string | null;
  markup_type: string | null;
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));

function fileOf(id: number | null, name: string | null, type: string | null, quoteNo: string): ProofFile | null {
  if (!id || !name) return null;
  return { id, filename: name, content_type: type, url: `/api/quote-attachments/${id}?quote_no=${encodeURIComponent(quoteNo)}` };
}

export async function loadProofs(quoteId: number, quoteNo: string): Promise<ProofOut[]> {
  try {
    const rows = await q<Row>(
      `SELECT p.version, p.status, p.note, p.sent_at, p.sent_by, p.attachment_id,
              a.filename AS file_name, a.content_type AS file_type,
              p.response_at, p.response_name, p.response_comment, p.response_by_staff,
              p.response_attachment_id, m.filename AS markup_name, m.content_type AS markup_type
         FROM public.quote_proofs p
         LEFT JOIN public.quote_attachments a ON a.id = p.attachment_id
         LEFT JOIN public.quote_attachments m ON m.id = p.response_attachment_id
        WHERE p.quote_id = $1
        ORDER BY p.version DESC`,
      [quoteId],
    );
    return rows.map((r) => ({
      version: Number(r.version),
      status: r.status,
      note: r.note,
      sent_at: iso(r.sent_at),
      sent_by: r.sent_by,
      file: fileOf(Number(r.attachment_id), r.file_name, r.file_type, quoteNo),
      response: r.response_at
        ? {
            at: iso(r.response_at),
            name: r.response_name,
            comment: r.response_comment,
            by_staff: !!r.response_by_staff,
            file: fileOf(r.response_attachment_id == null ? null : Number(r.response_attachment_id), r.markup_name, r.markup_type, quoteNo),
          }
        : null,
    }));
  } catch {
    return [];
  }
}

export async function quotePrinted(quoteId: number, quoteNo: string): Promise<boolean> {
  const facts = ((await loadFacts(quoteNo).catch(() => null)) || {}) as Record<string, unknown>;
  let plates = 0;
  if (facts.print_mode === "per_box") {
    const r = await one<{ p: unknown }>(
      `SELECT COALESCE(SUM((to_jsonb(qbs) ->> 'plates_usd')::numeric), 0) AS p
         FROM public.quote_box_selections qbs WHERE qbs.quote_id = $1`,
      [quoteId],
    ).catch(() => null);
    plates = Number(r?.p) || 0;
  }
  return factsPrinted(facts, plates);
}

export async function proofSummary(quote: { id: number; quote_no: string }): Promise<ProofSummary> {
  const [versions, required] = await Promise.all([loadProofs(quote.id, quote.quote_no), quotePrinted(quote.id, quote.quote_no)]);
  const { stage, latest } = proofStage(versions);
  return { required, stage, latest_version: latest ? latest.version : null, versions };
}

function cleanFilename(name: string): string {
  const base = String(name || "proof").split(/[\\/]/).pop() || "proof";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|]/g, "").trim();
  return (cleaned || "proof").slice(0, 120);
}

/** Store a proof / marked-up file. Returns the attachment id, or a buyer-readable problem. */
export async function saveProofFile(
  quote: { id: number; quote_no: string },
  file: File,
  kind: "proof" | "proof_markup",
): Promise<{ id: number } | { problem: string }> {
  const problem = artworkProblem(file.name, file.size);
  if (problem) return { problem };
  const ext = artworkExt(file.name);
  const contentType = ARTWORK_CONTENT_TYPES[ext] || "application/octet-stream";
  const buf = Buffer.from(await file.arrayBuffer());
  const row = await one<{ id: number }>(
    `INSERT INTO public.quote_attachments (quote_id, quote_no, filename, content_type, size_bytes, data, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [quote.id, quote.quote_no, cleanFilename(file.name), contentType, buf.length, buf, kind],
  );
  return row ? { id: Number(row.id) } : { problem: "We couldn't save the file. Please try again." };
}

/** A File from a multipart form field, or null. */
export function formFile(form: FormData, field: string): File | null {
  const f = form.get(field);
  return f && typeof f === "object" && typeof (f as File).arrayBuffer === "function" && (f as File).size > 0 ? (f as File) : null;
}
