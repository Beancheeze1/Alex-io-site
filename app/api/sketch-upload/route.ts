// app/api/sketch-upload/route.ts
//
// Handle "Upload file" from /sketch-upload page.
// - Saves the file into quote_attachments (with quote_id + quote_no when possible)
// - If the client provided an email, stores it on the quote header (if missing)
// - Calls /api/sketch/parse to run vision
// - Calls /api/sketch/apply to send an updated quote email (Option A)
//
// Forge integration (feature-flagged):
// - For PDF/DXF inputs, send to Forge, get loops (faces_json), emit normalized.dxf + forge_manifest.json
// - Loud failure on errors/ambiguity
// - Skip vision + auto-apply when Forge path is used
//
// Returns JSON:
// {
//   ok: true,
//   attachmentId,
//   quoteId,
//   quoteNo,
//   filename,
//   size,
//   type,
//   parsed,
//   autoQuote
// }

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function err(error: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

type AttachRow = {
  id: number;
  quote_id: number | null;
  quote_no: string | null;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
};

function isForgeEnabled(): boolean {
  const v = (process.env.ALEX_FORGE_INGESTION_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function extOf(name: string): string {
  const base = (name || "").split("/").pop()!.split("\\").pop()!;
  const idx = base.lastIndexOf(".");
  if (idx < 0) return "";
  return base.slice(idx + 1).toLowerCase();
}

function isForgeSupportedUpload(
  filename: string,
  contentType: string,
): { ok: boolean; sourceType: "pdf" | "dxf" | "stl" | null } {
  const ext = extOf(filename);
  const ct = (contentType || "").toLowerCase();

  if (ext === "pdf" || ct === "application/pdf") return { ok: true, sourceType: "pdf" };
  if (ext === "dxf" || ct.includes("dxf") || ct === "application/dxf") return { ok: true, sourceType: "dxf" };
  if (
    ext === "stl" ||
    ct.includes("stl") ||
    ct === "model/stl" ||
    ct === "application/sla"
  ) {
    return { ok: true, sourceType: "stl" };
  }

  return { ok: false, sourceType: null };
}

type ForgeDiag = { severity?: string; code?: string; message?: string; data_json?: any };
type ForgeArtifact = { id: number; kind: string; storage_key: string };

type ForgeJobGet = {
  ok: boolean;
  job?: { id?: number; status?: string; units?: "in" | "mm" | null };
  artifacts?: ForgeArtifact[];
  diagnostics?: ForgeDiag[];
};

type FacesJson = {
  units?: "in" | "mm";
  outerLoopIndex?: number;
  loops?: Array<{
    idx: number;
    closed: boolean;
    points: Array<{ x: number; y: number }>;
  }>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function createQuoteWithAutoNumber(email: string | null) {
  return one<{ id: number; quote_no: string }>(
    `
    INSERT INTO quotes (quote_no, email)
    VALUES (public.next_quote_no(), $1)
    RETURNING id, quote_no;
    `,
    [email],
  );
}

function dxfFromLoops(params: { units: "in" | "mm"; loops: Array<Array<{ x: number; y: number }>> }): string {
  const unitsCode = params.units === "mm" ? 4 : 1; // DXF INSUNITS

  const push: string[] = [];
  const pushPair = (code: number | string, value: number | string) => {
    push.push(String(code));
    push.push(String(value));
  };

  const polyline = (pts: Array<{ x: number; y: number }>, layer: string) => {
    // LWPOLYLINE closed
    pushPair(0, "LWPOLYLINE");
    pushPair(8, layer);
    pushPair(90, pts.length);
    pushPair(70, 1);
    for (const p of pts) {
      pushPair(10, p.x);
      pushPair(20, p.y);
    }
  };

  // HEADER
  pushPair(0, "SECTION");
  pushPair(2, "HEADER");
  pushPair(9, "$INSUNITS");
  pushPair(70, unitsCode);
  pushPair(0, "ENDSEC");

  // TABLES: minimal LAYER table
  pushPair(0, "SECTION");
  pushPair(2, "TABLES");
  pushPair(0, "TABLE");
  pushPair(2, "LAYER");
  pushPair(70, 1);
  pushPair(0, "LAYER");
  pushPair(2, "LOOP");
  pushPair(70, 0);
  pushPair(62, 7);
  pushPair(6, "CONTINUOUS");
  pushPair(0, "ENDTAB");
  pushPair(0, "ENDSEC");

  // ENTITIES
  pushPair(0, "SECTION");
  pushPair(2, "ENTITIES");
  for (const loop of params.loops) polyline(loop, "LOOP");
  pushPair(0, "ENDSEC");
  pushPair(0, "EOF");

  return push.join("\n");
}

function computeBbox(loops: Array<Array<{ x: number; y: number }>>): { x: number; y: number } | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  let any = false;
  for (const loop of loops) {
    for (const p of loop) {
      const x = Number(p.x);
      const y = Number(p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      any = true;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!any) return null;
  return { x: maxX - minX, y: maxY - minY };
}

async function forgeNormalizeToDxf(args: {
  buf: Buffer;
  filename: string;
  contentType: string;
  sourceType: "pdf" | "dxf" | "stl";
}): Promise<{ normalizedDxf: Buffer; manifest: any; facesBytes: Buffer }> {
  const forgeBase = (process.env.ALEX_FORGE_BASE_URL || "").trim();
  if (!forgeBase) {
    throw new Error("ALEX_FORGE_BASE_URL is not set");
  }

  // 1) create job + upload file (single call)
  const form = new FormData();

  // FIX #1: BlobPart typing -- wrap Buffer as Uint8Array explicitly
  const bytes = new Uint8Array(args.buf);
  const blob = new Blob([bytes], { type: args.contentType || "application/octet-stream" });

  form.append("file", blob, args.filename || "input");

  const createResp = await fetch(`${forgeBase}/api/jobs`, {
    method: "POST",
    body: form,
  });

  const createJson = (await createResp.json().catch(() => ({} as any))) as any;
  if (!createResp.ok || !createJson?.ok || !createJson?.job_id) {
    throw new Error(`Forge job create/upload failed: ${JSON.stringify(createJson)}`);
  }
  const jobId = Number(createJson.job_id);

  // 3) poll for faces_json artifact or terminal fail
  const timeoutMs = 60000;
  const started = Date.now();

  let last: ForgeJobGet | null = null;

  while (Date.now() - started < timeoutMs) {
    const stResp = await fetch(`${forgeBase}/api/jobs/${jobId}`, { method: "GET" });
    const stJson = (await stResp.json().catch(() => ({}))) as ForgeJobGet;
    last = stJson;

    if (stResp.ok && stJson?.ok) {
      const status = String(stJson.job?.status || "");
      const artifacts = Array.isArray(stJson.artifacts) ? stJson.artifacts : [];

      const faces = artifacts.find((a) => String(a.kind) === "faces_json");
      if (faces?.id) {
        // Fetch faces.json bytes
        const facesResp = await fetch(`${forgeBase}/api/jobs/${jobId}/artifacts/${faces.id}?preview=1`);

        // FIX #2: arrayBuffer() typing -- convert via Uint8Array
        const ab = await facesResp.arrayBuffer();
        const facesBytes = Buffer.from(new Uint8Array(ab));

        let facesJson: FacesJson | null = null;
        try {
          facesJson = JSON.parse(facesBytes.toString("utf8"));
        } catch {
          facesJson = null;
        }

        // Build manifest from diagnostics (loud failure if any errors)
        const diags = Array.isArray(stJson.diagnostics) ? stJson.diagnostics : [];
        const warnings: any[] = [];
        const errors: any[] = [];

        for (const d of diags) {
          const sev = String(d?.severity || "").toLowerCase();
          const item = {
            code: d?.code || null,
            message: d?.message || null,
            data: d?.data_json ?? null,
          };
          if (sev === "error" || sev === "fatal") errors.push(item);
          else warnings.push(item);
        }

        let units = (stJson.job?.units || facesJson?.units || null) as any;

// DXF v1 behavior: DXF often has no explicit units. Default to inches but be loud via warning.
// PDF stays strict: missing units is an error.
if (units !== "in" && units !== "mm") {
  if (args.sourceType === "dxf" || args.sourceType === "stl") {
    warnings.push({
      code: "units_defaulted",
      message: "Forge did not provide units; defaulting to inches for DXF v1.",
      data: { units_in: units, defaulted_to: "in" },
    });
    units = "in";
  } else {
    errors.push({
      code: "units_unknown",
      message: "Forge did not provide units (mm|in).",
      data: { units },
    });
  }
}


        const loopsRaw = Array.isArray(facesJson?.loops) ? facesJson!.loops! : [];
        const loopsClosed = loopsRaw
          .filter((l) => l && l.closed && Array.isArray(l.points) && l.points.length >= 3)
          .map((l) => l.points.map((p) => ({ x: Number(p.x), y: Number(p.y) })));

        if (!loopsClosed.length) {
          errors.push({
            code: "no_closed_loops",
            message: "Forge output did not contain any closed loops.",
            data: { loopsCount: loopsRaw.length },
          });
        }

        const bbox = computeBbox(loopsClosed);
        if (!bbox) {
          errors.push({ code: "bbox_failed", message: "Could not compute bbox from loops.", data: null });
        }

        const manifest = {
          source_type: args.sourceType,
          units: units === "mm" || units === "in" ? units : null,
          bbox: bbox || null,
          warnings,
          errors,
        };

        if (errors.length) {
          // Loud failure
          return {
            normalizedDxf: Buffer.from(""),
            manifest,
            facesBytes: Buffer.from(""),
          };
        }

        const dxfText = dxfFromLoops({ units, loops: loopsClosed });
        return {
          normalizedDxf: Buffer.from(dxfText, "utf8"),
          manifest,
          facesBytes,
        };
      }

      if (status === "failed" || status === "blocked") {
        const diags = Array.isArray(stJson.diagnostics) ? stJson.diagnostics : [];
        const errors = diags
          .filter((d) => String(d?.severity || "").toLowerCase() === "error")
          .map((d) => ({ code: d?.code || null, message: d?.message || null, data: d?.data_json ?? null }));

        const manifest = {
          source_type: args.sourceType,
          units: stJson.job?.units ?? null,
          bbox: null,
          warnings: [],
          errors: errors.length
            ? errors
            : [{ code: "forge_failed", message: `Forge job ended with status=${status}`, data: { status } }],
        };

        return { normalizedDxf: Buffer.from(""), manifest, facesBytes: Buffer.from("") };
      }
    }

    await sleep(800);
  }

  throw new Error(
    `Forge did not produce faces_json before timeout. job_id=${jobId}. last=${JSON.stringify(
      last,
    )}`,
  );
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return err("invalid_form", "Expected multipart/form-data");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return err("missing_file", "file is required");
    }

    // NEW: also read quote_no from query string (same fix as last time)
    const url = new URL(req.url);
    const qpQuoteNo = url.searchParams.get("quote_no") || url.searchParams.get("quoteNo");

    const quoteNoRaw =
      (form.get("quote_no") as string | null) ||
      (form.get("quoteNo") as string | null) ||
      qpQuoteNo ||
      "";

    let quoteNo = quoteNoRaw.trim() || null;

    const emailRaw = form.get("email") as string | null;
    const email = (emailRaw && emailRaw.toString().trim()) || null;

    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf) as Buffer<ArrayBufferLike>;
    const contentType = file.type || "application/octet-stream";
    const origFilename = file.name || `upload-${Date.now().toString().slice(-6)}.bin`;

    // Resolve quote_id and, if needed, store email onto the quote header
    let quoteId: number | null = null;

    if (quoteNo) {
      const row = await one<{ id: number; email: string | null }>(
        `
        SELECT id, email
        FROM quotes
        WHERE quote_no = $1
        LIMIT 1;
        `,
        [quoteNo],
      );

      if (row) {
        quoteId = row.id;

        // If user provided an email and the quote doesn't have one yet, store it
        if (email && !row.email) {
          const updated = await one<{ id: number; email: string | null }>(
            `
            UPDATE quotes
            SET email = $2
            WHERE id = $1
            RETURNING id, email;
            `,
            [row.id, email],
          );
          if (updated) {
            quoteId = updated.id;
          }
        }
      }
    }

    if (quoteNo && !quoteId) {
      return err("quote_not_found", { quoteNo }, 404);
    }

    if (!quoteNo) {
      const created = await createQuoteWithAutoNumber(email);
      if (!created) return err("quote_create_failed", "Could not create quote", 500);

      quoteId = created.id;
      quoteNo = created.quote_no;
    }

    // Feature-flagged Forge ingestion (DXF-primary v1)
    const forgeOn = isForgeEnabled();
    const kind = isForgeSupportedUpload(origFilename, contentType);

    if (forgeOn && kind.ok && kind.sourceType) {
      let normalized = buf;
      let normalizedFilename = origFilename;
      let normalizedContentType = contentType;
      let manifest: any = null;
      let facesBytes: Buffer = Buffer.from("");

      try {
        const res = await forgeNormalizeToDxf({
          buf,
          filename: origFilename,
          contentType,
          sourceType: kind.sourceType,
        });

        manifest = res.manifest;
        facesBytes = res.facesBytes ?? Buffer.from("");

        // Loud failure if errors present (contract: errors[] non-empty => reject)
        const errs = Array.isArray(manifest?.errors) ? manifest.errors : [];
        if (errs.length) {
          return err("forge_rejected", manifest, 422);
        }

        normalized = res.normalizedDxf;
        normalizedFilename = "normalized.dxf";
        normalizedContentType = "application/dxf";
      } catch (e: any) {
        return err("forge_exception", String(e?.message || e), 500);
      }

      // Store normalized.dxf in quote_attachments
      const inserted = (await one<AttachRow>(
        `
        INSERT INTO quote_attachments
          (quote_id, quote_no, filename, content_type, size_bytes, data)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, quote_id, quote_no, filename, content_type, size_bytes;
        `,
        [quoteId, quoteNo, normalizedFilename, normalizedContentType, normalized.length, normalized],
      )) as AttachRow | null;

      if (!inserted) {
        return err("insert_failed", "Could not create quote_attachments row", 500);
      }

      // Store forge_manifest.json as a second attachment (for audit/debug; editor can ignore)
      const manifestText = JSON.stringify(manifest ?? {}, null, 2);
      await one(
        `
        INSERT INTO quote_attachments
          (quote_id, quote_no, filename, content_type, size_bytes, data)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id;
        `,
        [
          inserted.quote_id,
          inserted.quote_no,
          "forge_manifest.json",
          "application/json",
          Buffer.byteLength(manifestText, "utf8"),
          Buffer.from(manifestText, "utf8"),
        ],
      );

      let facesAttachmentId: number | null = null;
      if (facesBytes && facesBytes.length > 0) {
        const facesRow = await one<{ id: number }>(
          `
          INSERT INTO quote_attachments
            (quote_id, quote_no, filename, content_type, size_bytes, data)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id;
          `,
          [
            inserted.quote_id,
            inserted.quote_no,
            "forge_faces.json",
            "application/json",
            facesBytes.length,
            facesBytes,
          ],
        );
        facesAttachmentId = facesRow?.id ?? null;
      }

      // Per v1: DO NOT run vision parse or auto-apply; return the normalized DXF attachment
      return NextResponse.json(
        {
          ok: true,
          attachmentId: inserted.id,
          quoteId: quoteId,
          quoteNo: quoteNo,
          filename: inserted.filename,
          size: inserted.size_bytes,
          type: inserted.content_type,
          parsed: null,
          autoQuote: null,
          forge: { used: true, manifest, faces_attachment_id: facesAttachmentId },
        },
        { status: 200 },
      );
    }

    // Default legacy path (unchanged)
    const size = buf.length;
    const filename = origFilename;

    // Store in quote_attachments
    const inserted = (await one<AttachRow>(
      `
      INSERT INTO quote_attachments
        (quote_id, quote_no, filename, content_type, size_bytes, data)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, quote_id, quote_no, filename, content_type, size_bytes;
      `,
      [quoteId, quoteNo, filename, contentType, size, buf],
    )) as AttachRow | null;

    if (!inserted) {
      return err("insert_failed", "Could not create quote_attachments row", 500);
    }

    const attachmentId = inserted.id;
    const storedQuoteId = inserted.quote_id;
    const storedQuoteNo = inserted.quote_no;

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    // 1) Call /api/sketch/parse to run vision on the image/PDF
    let parsed: any = null;
    try {
      const parseResp = await fetch(`${base}/api/sketch/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_no: storedQuoteNo,
          attachmentId,
        }),
      });

      const parseJson = await parseResp.json().catch(() => ({} as any));
      if (parseResp.ok && parseJson && parseJson.ok) {
        parsed = parseJson.parsed || null;
      }
    } catch (e) {
      console.error("sketch-upload: parse call failed:", e);
    }

    // 2) Auto-apply the parsed sketch to re-quote + send email
    let autoQuote: any = null;
    try {
      if (storedQuoteNo) {
        const applyResp = await fetch(`${base}/api/sketch/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote_no: storedQuoteNo,
            attachmentId,
            parsed,
          }),
        });

        const applyJson = await applyResp.json().catch(() => ({} as any));
        autoQuote = applyJson;
      }
    } catch (e) {
      console.error("sketch-upload: apply call failed:", e);
    }

    return NextResponse.json(
      {
        ok: true,
        attachmentId,
        quoteId: storedQuoteId,
        quoteNo: storedQuoteNo,
        filename: inserted.filename,
        size: inserted.size_bytes,
        type: inserted.content_type,
        parsed,
        autoQuote,
      },
      { status: 200 },
    );
  } catch (e: any) {
    console.error("sketch-upload exception:", e);
    return err("sketch_upload_exception", String(e?.message || e), 500);
  }
}
