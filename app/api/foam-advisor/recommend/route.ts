// app/api/foam-advisor/recommend/route.ts
//
// Foam Advisor recommend endpoint (stub version).
//
// Path A safe:
// - NO database access yet.
// - Uses only request body fields to compute static load (psi)
//   and returns generic PE / PU / XLPE suggestions.
// - Later we can replace the recommendation block to pull from
//   materials + cushion_curves without changing the API surface.
//

import { NextResponse } from "next/server";

type EnvironmentOption = "normal" | "cold_chain" | "vibration";
type FragilityOption = "very_fragile" | "moderate" | "rugged";

type Recommendation = {
  key: string;
  family: string;
  label: string;
  confidence: "primary" | "alternative" | "stretch";
  notes: string;
};

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const weightLb = Number(body.weightLb);
  const contactAreaIn2 = Number(body.contactAreaIn2);
  const environment = (body.environment ??
    "normal") as EnvironmentOption;
  const fragility = (body.fragility ??
    "moderate") as FragilityOption;

  if (!Number.isFinite(weightLb) || weightLb <= 0) {
    return NextResponse.json(
      { ok: false, error: "invalid_weight" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(contactAreaIn2) || contactAreaIn2 <= 0) {
    return NextResponse.json(
      { ok: false, error: "invalid_area" },
      { status: 400 },
    );
  }

  const staticLoadPsi = weightLb / contactAreaIn2;

  // Friendly labels (keep in sync with FoamAdvisorPage text).
  let environmentLabel = "Normal parcel / LTL";
  if (environment === "cold_chain") {
    environmentLabel = "Cold chain / refrigerated";
  } else if (environment === "vibration") {
    environmentLabel = "Heavy vibration / rough handling";
  }

  let fragilityLabel = "General industrial components";
  if (fragility === "very_fragile") {
    fragilityLabel = "Very fragile electronics / optics";
  } else if (fragility === "rugged") {
    fragilityLabel = "Rugged hardware / tooling";
  }

  // --- Simple, generic suggestion logic (no DB yet) ---

  const recs: Recommendation[] = [];

  // Heuristic bands: low / medium / high static load
  const lowLoad = staticLoadPsi < 0.3;
  const mediumLoad = staticLoadPsi >= 0.3 && staticLoadPsi <= 1.0;
  const highLoad = staticLoadPsi > 1.0;

  if (fragility === "very_fragile") {
    // Softer PU plus fine-cell XLPE
    recs.push({
      key: "soft_pu_primary",
      family: "Polyurethane Foam",
      label: "Soft PU (≈ 1.3–1.5 pcf)",
      confidence: "primary",
      notes:
        "Good for very fragile items and low static loads. Look for a curve where your static load sits near the flat middle of the deflection band.",
    });
    recs.push({
      key: "xlpe_alt",
      family: "Cross-linked Polyethylene",
      label: "Soft XLPE (≈ 1.7–2.0 pcf)",
      confidence: "alternative",
      notes:
        "Fine-cell XLPE works well when you need a cleaner look or repeated use. Keep deflection moderate so g-levels stay below your fragility band.",
    });
    if (mediumLoad || highLoad) {
      recs.push({
        key: "med_pe_stretch",
        family: "Polyethylene",
        label: "Medium PE (≈ 1.7 pcf)",
        confidence: "stretch",
        notes:
          "Use with extra care for very fragile items—only if curves show acceptable g-levels at your static load and a reasonable deflection.",
      });
    }
  } else if (fragility === "rugged") {
    // Lean harder into PE
    recs.push({
      key: "med_pe_primary",
      family: "Polyethylene",
      label: "Medium PE (≈ 1.7–2.2 pcf)",
      confidence: "primary",
      notes:
        "Workhorse option for rugged hardware. Aim for the central, efficient part of the cushion curve at your expected drop height.",
    });
    if (highLoad) {
      recs.push({
        key: "firm_pe_alt",
        family: "Polyethylene",
        label: "Firmer PE (≈ 2.2–4.0 pcf)",
        confidence: "alternative",
        notes:
          "Consider higher density PE when static loads climb and you need more support with limited deflection.",
      });
    }
    recs.push({
      key: "pu_alt",
      family: "Polyurethane Foam",
      label: "Medium PU (≈ 1.9–2.2 pcf)",
      confidence: "stretch",
      notes:
        "Can help when you want a softer feel but products are still relatively rugged.",
    });
  } else {
    // Moderate fragility → balanced mix
    if (lowLoad) {
      recs.push({
        key: "soft_pu_primary_mod",
        family: "Polyurethane Foam",
        label: "Soft–medium PU (≈ 1.5–1.9 pcf)",
        confidence: "primary",
        notes:
          "Static load is low; softer PU helps keep g-levels down without over-compressing the foam.",
      });
    } else if (mediumLoad) {
      recs.push({
        key: "med_pe_primary_mod",
        family: "Polyethylene",
        label: "Medium PE (≈ 1.7 pcf)",
        confidence: "primary",
        notes:
          "Good balance of support and protection for general industrial components.",
      });
    } else if (highLoad) {
      recs.push({
        key: "firm_pe_primary_mod",
        family: "Polyethylene",
        label: "Firmer PE (≈ 2.2–4.0 pcf)",
        confidence: "primary",
        notes:
          "Higher static load favors firmer materials to avoid bottoming-out at typical deflections.",
      });
    }

    recs.push({
      key: "xlpe_alt_mod",
      family: "Cross-linked Polyethylene",
      label: "XLPE in similar density band",
      confidence: "alternative",
      notes:
        "Use when you need cleaner edges, laminated sets, or repeated use with similar performance to standard PE.",
    });

    recs.push({
      key: "pu_alt_mod",
      family: "Polyurethane Foam",
      label: "PU alternative in matching density",
      confidence: "stretch",
      notes:
        "Useful when you want more cushioning feel or tighter fit around complex shapes.",
    });
  }

  const response = {
    ok: true,
    staticLoadPsi,
    staticLoadPsiLabel: `Static load ≈ ${staticLoadPsi.toFixed(
      3,
    )} psi (weight ÷ area).`,
    environment,
    environmentLabel,
    fragility,
    fragilityLabel,
    recommendations: recs,
  };

  return NextResponse.json(response);
}
