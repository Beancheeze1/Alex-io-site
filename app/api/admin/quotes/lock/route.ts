import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { computeGeometryHash } from "@/app/lib/layout/exports";

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
  layout_json: any;
  created_at: string;
};

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
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

  const pkg = await one<LayoutPkgRow>(
    `
    select id, layout_json, created_at
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

  const hash = computeGeometryHash(pkg.layout_json);
  const storedHash = typeof quote.geometry_hash === "string" ? quote.geometry_hash : "";

  if (quote.locked && storedHash && storedHash !== hash) {
    return json(
      { ok: false, error: "GEOMETRY_HASH_MISMATCH", message: "Stored hash differs from current layout." },
      409,
    );
  }

  await q(
    `
    update quotes
    set locked = true,
        geometry_hash = $2,
        locked_at = now()
    where id = $1
    `,
    [quote.id, hash],
  );

  return json({ ok: true, locked: true, geometry_hash: hash });
}
