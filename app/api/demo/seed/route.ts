// app/api/demo/seed/route.ts
//
// Public (no auth required) endpoint that creates a real demo quote in the DB.
// Called by the /landing page form and the landing page chat widget when the
// prospect wants to try the full quoting flow.
//
// What it does:
//   1. Generates a Q-DEMO-YYYYMMDD-xxxxxx quote number
//   2. Inserts a quotes row with is_demo=true scoped to the default tenant
//   3. Inserts a primary quote_items row from the form dimensions
//   4. Seeds the facts store (memory) so the layout editor and print view
//      load with the right context
//   5. Returns { ok: true, quoteNo, redirectPath } — client navigates there
//
// What it does NOT do:
//   - No session/auth check (this is a public entry point)
//   - No email sending
//   - No webhook calls
//   - No pricing engine calls (editor does that on load)
//
// ISOLATION: The only tables written are quotes (is_demo=true) and quote_items.
// The admin cleanup tool already handles deleting demo quotes.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { saveFacts } from "@/app/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function buildDemoQuoteNo(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `Q-DEMO-${y}${mo}${day}-${rand}`;
}

function toPositiveFloat(raw: unknown): number | null {
  const n = Number(String(raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toPositiveInt(raw: unknown): number | null {
  const n = Math.round(Number(String(raw ?? "").trim()));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Request shape ─────────────────────────────────────────────────────────────

type DemoSeedBody = {
  // Dimensions (inches)
  outsideL: string | number;
  outsideW: string | number;
  outsideH: string | number;
  // Order qty
  qty: string | number;
  // Contact (optional — nice to have on the quote header)
  customerName?: string;
  customerEmail?: string;
  company?: string;
  // Soft intent fields (saved to facts, not to quote_items)
  shipMode?: string;
  insertType?: string;
  layerCount?: string;
  layerThicknesses?: string[];
  holding?: string;
  pocketCount?: string;
  materialMode?: string;
  materialText?: string;
  materialId?: number | null;
  cavities?: string;
  notes?: string;
  // Packaging
  packagingSku?: string;
  packagingChoice?: string | null;
  printed?: boolean | null;
  // Source tag (widget vs form)
  source?: string;
};

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: DemoSeedBody = await req.json().catch(() => ({}));

    // ── Validate required dims ──────────────────────────────────────────────
    const L = toPositiveFloat(body.outsideL);
    const W = toPositiveFloat(body.outsideW);
    const H = toPositiveFloat(body.outsideH);
    const qty = toPositiveInt(body.qty);

    if (!L || !W || !H || !qty) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_DIMS",
          message: "outsideL, outsideW, outsideH (positive numbers, inches) and qty (positive integer) are required.",
        },
        { status: 400 },
      );
    }

    // ── Resolve default tenant ──────────────────────────────────────────────
    // Demo quotes always go to the default tenant (the first active one).
    const tenantRow = await one<{ id: number; slug: string }>(
      `SELECT id, slug FROM public.tenants WHERE active = true ORDER BY id ASC LIMIT 1`,
      [],
    );

    if (!tenantRow) {
      return NextResponse.json(
        { ok: false, error: "NO_TENANT", message: "No active tenant found." },
        { status: 500 },
      );
    }

    const tenantId = tenantRow.id;

    // ── Find first active material (fallback for quote_items) ───────────────
    // We pick the first active material as a sensible default. The layout editor
    // lets the prospect change material before Apply so this is just a placeholder.
    const materialRow = await one<{ id: number; name: string }>(
      `SELECT id, name FROM public.materials WHERE active = true ORDER BY id ASC LIMIT 1`,
      [],
    );

    const materialId = materialRow?.id ?? 1;
    const materialName = materialRow?.name ?? "Foam";

    // ── Build quote number ──────────────────────────────────────────────────
    // Retry up to 3 times in the astronomically unlikely case of a collision
    let quoteNo = "";
    let quoteRow: any = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      quoteNo = buildDemoQuoteNo();

      const customerName =
        String(body.customerName ?? "").trim() || "Demo Prospect";
      const email = String(body.customerEmail ?? "").trim() || null;
      const company = String(body.company ?? "").trim() || null;

      quoteRow = await one(
        `
        INSERT INTO public."quotes" (
          tenant_id,
          quote_no,
          customer_name,
          email,
          company,
          status,
          is_demo
        )
        VALUES ($1, $2, $3, $4, $5, 'draft', true)
        ON CONFLICT (quote_no) DO NOTHING
        RETURNING id, quote_no, tenant_id
        `,
        [tenantId, quoteNo, customerName, email, company],
      );

      if (quoteRow) break;
    }

    if (!quoteRow) {
      return NextResponse.json(
        { ok: false, error: "QUOTE_CREATE_FAILED", message: "Failed to create demo quote. Please try again." },
        { status: 500 },
      );
    }

    const quoteId: number = quoteRow.id;

    // ── Insert primary quote_items row ──────────────────────────────────────
    // Height_in = full stack depth. Material = first active material as placeholder.
    await q(
      `
      INSERT INTO public.quote_items (
        quote_id,
        length_in,
        width_in,
        height_in,
        qty,
        material_id,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        quoteId,
        L,
        W,
        H,
        qty,
        materialId,
        `Demo quote — ${materialName}. Material and layout editable in the editor.`,
      ],
    );

    // ── Seed the facts store ────────────────────────────────────────────────
    // This is what the layout editor, apply route, and print view all read.
    // Mirrors exactly what the real chat widget seeds so the editor opens
    // in the right state.
    const facts: Record<string, unknown> = {
      // Dimensions
      outside: { l: String(L), w: String(W), h: String(H), units: "in" },
      outsideL: String(L),
      outsideW: String(W),
      outsideH: String(H),

      // Order
      qty: String(qty),

      // Intent
      shipMode: body.shipMode ?? "unsure",
      insertType: body.insertType ?? "single",
      holding: body.holding ?? "pockets",
      pocketCount: body.pocketCount ?? "1",
      layerCount: body.layerCount ?? "1",
      layerThicknesses: Array.isArray(body.layerThicknesses) ? body.layerThicknesses : [],

      // Material (placeholder — editor overrides)
      materialMode: body.materialMode ?? "recommend",
      materialText: body.materialText ?? "",
      materialId: typeof body.materialId === "number" ? body.materialId : null,

      // Cavities
      cavities: body.cavities ?? "",

      // Packaging
      packagingSku: body.packagingSku ?? "",
      packagingChoice: body.packagingChoice ?? null,
      printed: body.printed ?? false,

      // Customer
      customerName: String(body.customerName ?? "").trim() || "Demo Prospect",
      customerEmail: String(body.customerEmail ?? "").trim() || "",
      company: String(body.company ?? "").trim() || "",

      // Notes
      notes: String(body.notes ?? "").trim(),

      // Revision init
      stage_rev: "AS",
      revision: "AS",

      // Demo flag in facts (belt + suspenders — DB is the source of truth)
      is_demo: true,
      source: body.source ?? "landing-demo",
    };

    await saveFacts(quoteNo, facts);

    // ── Build editor URL — mirrors StartQuoteModal.onLaunchEditor() exactly ──
    //
    // The layout editor (app/quote/layout/page.tsx) seeds itself from URL params:
    // dims=, layer_thicknesses=, layer_label=, cavities=, qty=, customer_name=, etc.
    // A bare quote_no= alone opens a blank 10x10x2 layout — we must pass the same
    // params StartQuoteModal builds so the editor opens correctly seeded.

    const FIT_ALLOW_IN = 0.125;
    const DEFAULT_TOP_PAD_IN = 1.0;

    const shipMode = String(body.shipMode ?? "unsure");
    const insertType = String(body.insertType ?? "single");
    const isCompletePack = shipMode === "box" || shipMode === "mailer";

    const p = new URLSearchParams();
    p.set("quote_no", quoteNo);
    p.set("demo", "1");
    p.set("qty", String(qty));

    // Customer info
    const customerName = String(body.customerName ?? "").trim();
    const customerEmail = String(body.customerEmail ?? "").trim();
    const company = String(body.company ?? "").trim();
    if (customerName) p.set("customer_name", customerName);
    if (customerEmail) p.set("customer_email", customerEmail);
    if (company) p.set("customer_company", company);

    // Material
    if (typeof body.materialId === "number" && body.materialId > 0) {
      p.set("material_id", String(body.materialId));
      p.set("material_mode", "known");
    }
    if (String(body.materialText ?? "").trim()) {
      p.set("material_text", String(body.materialText).trim());
    }

    // Cavities seed
    const cavities = String(body.cavities ?? "").trim();
    if (cavities) p.set("cavities", cavities);

    if (isCompletePack) {
      // Complete pack: foam fits inside box with FIT_ALLOW_IN undersize
      const foamL = Math.max(0, L - FIT_ALLOW_IN);
      const foamW = Math.max(0, W - FIT_ALLOW_IN);
      const thks = Array.isArray(body.layerThicknesses) ? body.layerThicknesses : [];

      let bottomD: number;
      let topD: number | null = null;

      if (insertType === "set") {
        bottomD = thks.length >= 1 && Number(thks[0]) > 0
          ? Number(thks[0])
          : Math.max(0, H - DEFAULT_TOP_PAD_IN);
        topD = thks.length >= 2 && Number(thks[thks.length - 1]) > 0
          ? Number(thks[thks.length - 1])
          : DEFAULT_TOP_PAD_IN;
      } else {
        bottomD = thks.length >= 1 && Number(thks[0]) > 0 ? Number(thks[0]) : H;
      }

      p.set("dims", `${foamL}x${foamW}x${bottomD}`);

      if (topD !== null) {
        p.set("layer_count", "2");
        p.append("layer_thicknesses", String(bottomD));
        p.append("layer_label", "Bottom Insert");
        p.append("layer_thicknesses", String(topD));
        p.append("layer_label", "Top Pad");
        p.set("layer_cavity_layer_index", "1");
        p.set("activeLayer", "1");
        p.set("active_layer", "1");
        p.set("top_pad_in", String(topD));
        p.set("foam_config", "bottom_top");
      } else {
        p.set("layer_count", "1");
        p.append("layer_thicknesses", String(bottomD));
        p.append("layer_label", "Layer 1");
        p.set("layer_cavity_layer_index", "1");
        p.set("activeLayer", "1");
        p.set("active_layer", "1");
        p.set("foam_config", "bottom_only");
      }

      p.set("box_l", String(L));
      p.set("box_w", String(W));
      p.set("box_d", String(H));
      p.set("box_style", shipMode === "box" ? "rsc" : "mailer");
      p.set("pack_type", "complete_pack");
      p.set("fit_allow_in", String(FIT_ALLOW_IN));
      p.set("printed", body.printed ? "1" : "0");

    } else {
      // Foam insert: dims straight from form
      p.set("dims", `${L}x${W}x${H}`);
      p.set("layer_count", "1");
      p.append("layer_thicknesses", String(H));
      p.append("layer_label", "Layer 1");
      p.set("layer_cavity_layer_index", "1");
      p.set("activeLayer", "1");
      p.set("active_layer", "1");
    }

    const redirectPath = `/quote/layout?${p.toString()}`;

    return NextResponse.json(
      {
        ok: true,
        quoteNo,
        redirectPath,
        tenantId,
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error("[demo/seed] Error:", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
