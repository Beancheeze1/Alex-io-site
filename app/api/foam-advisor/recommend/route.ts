// app/api/foam-advisor/recommend/route.ts
//
// Foam Advisor recommend endpoint.
//
// Real logic: computes static load (weight / bearing area), queries the
// actual `cushion_curves` table, interpolates the tested G-level at that
// operating point for every material with curve coverage, and ranks
// candidates against a numeric fragility (G) target using the standard
// public fragility tiers. Replaces the old fixed-psi-bucket / hardcoded
// density-band stub.

import { NextResponse } from "next/server";
import {
  recommendMaterials,
  fragilityTierForG,
  suggestDropHeightIn,
  FRAGILITY_TIERS,
  DROP_HEIGHT_TABLE,
} from "@/app/lib/cushion/engine";

type EnvironmentOption = "normal" | "cold_chain" | "vibration";

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
  const environment = (body.environment ?? "normal") as EnvironmentOption;
  const fragilityGMaxRaw = Number(body.fragilityGMax);
  const dropHeightInRaw = Number(body.dropHeightIn);

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

  // Fragility G target: real numeric input, defaulting to the top of the
  // "Fragile" tier (60G) if the caller doesn't supply one.
  const fragilityGMax =
    Number.isFinite(fragilityGMaxRaw) && fragilityGMaxRaw > 0
      ? fragilityGMaxRaw
      : 60;

  // Drop height: real numeric input, defaulting to the standard
  // weight-based table when the caller doesn't supply one.
  const dropHeightIn =
    Number.isFinite(dropHeightInRaw) && dropHeightInRaw > 0
      ? dropHeightInRaw
      : suggestDropHeightIn(weightLb);

  let environmentLabel = "Normal parcel / LTL";
  if (environment === "cold_chain") {
    environmentLabel = "Cold chain / refrigerated";
  } else if (environment === "vibration") {
    environmentLabel = "Heavy vibration / rough handling";
  }

  const fragilityTier = fragilityTierForG(fragilityGMax);

  try {
    const { staticPsi, candidates, materialsConsidered, materialsWithoutCurveData } =
      await recommendMaterials({
        weightLb,
        contactAreaIn2,
        fragilityGMax,
        dropHeightIn,
      });

    const response = {
      ok: true,
      staticLoadPsi: staticPsi,
      staticLoadPsiLabel: `Static load ~ ${staticPsi.toFixed(
        3,
      )} psi (weight / bearing area).`,
      environment,
      environmentLabel,
      fragilityGMax,
      fragilityTier: { key: fragilityTier.key, label: fragilityTier.label },
      dropHeightIn,
      dropHeightSuggested: !Number.isFinite(dropHeightInRaw) || dropHeightInRaw <= 0,
      candidates,
      materialsConsidered,
      materialsWithoutCurveData,
      reference: {
        fragilityTiers: FRAGILITY_TIERS,
        dropHeightTable: DROP_HEIGHT_TABLE,
      },
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("foam-advisor/recommend error:", err);
    return NextResponse.json(
      { ok: false, error: "recommend_exception", detail: String(err?.message || err) },
      { status: 500 },
    );
  }
}
