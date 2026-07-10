// app/lib/box-tier-pricing.ts
//
// Single source of truth for resolving a carton's unit price from
// box_price_tiers, and for validating that a box's tiers are sanely
// ordered.
//
// Previously, every call site (app/api/boxes/add-to-quote/route.ts,
// app/api/quote/print/route.ts, app/lib/commission-pricing.ts) picked a
// tier by iterating tier1 -> tier2 -> tier3 -> tier4 in fixed slot order
// and letting the LAST satisfied slot win. That means whichever tier
// happens to sit in a higher-numbered slot always wins over a
// lower-numbered slot whose condition is also met, regardless of which
// one actually has the larger min_qty. If an admin ever transposes two
// tiers' minimums, quantities that fall in the overlap silently get
// priced from the wrong tier.
//
// resolveBoxUnitPrice fixes this by picking, among all tiers whose
// min_qty is satisfied, the one with the LARGEST min_qty — i.e. the
// tightest-fitting, most-specific volume break — regardless of which
// slot it's stored in.

export type BoxTierInputs = {
  base_unit_price?: string | number | null;
  tier1_min_qty?: string | number | null;
  tier1_unit_price?: string | number | null;
  tier2_min_qty?: string | number | null;
  tier2_unit_price?: string | number | null;
  tier3_min_qty?: string | number | null;
  tier3_unit_price?: string | number | null;
  tier4_min_qty?: string | number | null;
  tier4_unit_price?: string | number | null;
};

function safeNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

type TierSlot = { slot: number; min: number | null; unit: number | null };

function tierSlots(tiers: BoxTierInputs | null | undefined): TierSlot[] {
  if (!tiers) return [];
  return [
    { slot: 1, min: safeNum(tiers.tier1_min_qty), unit: safeNum(tiers.tier1_unit_price) },
    { slot: 2, min: safeNum(tiers.tier2_min_qty), unit: safeNum(tiers.tier2_unit_price) },
    { slot: 3, min: safeNum(tiers.tier3_min_qty), unit: safeNum(tiers.tier3_unit_price) },
    { slot: 4, min: safeNum(tiers.tier4_min_qty), unit: safeNum(tiers.tier4_unit_price) },
  ];
}

/**
 * Resolve the correct per-unit price for a given quantity: the highest
 * min_qty tier that qty satisfies (and that has a price), falling back to
 * base_unit_price when no tier qualifies.
 */
export function resolveBoxUnitPrice(
  tiers: BoxTierInputs | null | undefined,
  qty: number,
): number | null {
  const base = safeNum(tiers?.base_unit_price ?? null);

  const satisfied = tierSlots(tiers).filter(
    (t) => t.min != null && t.min > 0 && t.unit != null && qty >= t.min,
  );

  if (satisfied.length === 0) return base;

  satisfied.sort((a, b) => (b.min as number) - (a.min as number));
  return satisfied[0].unit;
}

export type TierOrderWarning = {
  tierA: number;
  tierB: number;
  message: string;
};

/**
 * Flags tier pairs where a higher-numbered slot doesn't represent a
 * strictly larger volume break than a lower-numbered slot (the defect
 * that causes resolveBoxUnitPrice's predecessor to silently pick the
 * wrong tier), and/or where price doesn't decrease at the larger break.
 * Only compares slots that both have a min_qty set.
 */
export function validateBoxTierOrdering(
  tiers: BoxTierInputs | null | undefined,
): TierOrderWarning[] {
  const slots = tierSlots(tiers).filter((t) => t.min != null && t.min > 0);
  const warnings: TierOrderWarning[] = [];

  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i];
      const b = slots[j];

      const minViolated = (b.min as number) <= (a.min as number);
      const priceViolated =
        a.unit != null && b.unit != null && (b.unit as number) >= (a.unit as number);

      if (!minViolated && !priceViolated) continue;

      const parts: string[] = [];
      if (minViolated) {
        parts.push(
          `Tier ${b.slot}'s minimum qty (${b.min}) is not greater than Tier ${a.slot}'s (${a.min})`,
        );
      }
      if (priceViolated) {
        parts.push(
          `Tier ${b.slot}'s price ($${(b.unit as number).toFixed(2)}) is not lower than Tier ${a.slot}'s ($${(a.unit as number).toFixed(2)})`,
        );
      }

      warnings.push({
        tierA: a.slot,
        tierB: b.slot,
        message:
          parts.join(" and ") +
          (minViolated
            ? ". This can cause the wrong tier to be picked at quantities that satisfy both."
            : "."),
      });
    }
  }

  return warnings;
}
