// lib/validators.ts
import { z } from "zod";

/**
 * Robust number coercion:
 * - Accepts numbers or numeric strings (tolerates "12,5" -> 12.5)
 * - Treats "", null, undefined as undefined (so "required" errors show clearly)
 * - Uses refine() checks (works on ZodEffects)
 */
const coerceNumber = (opts?: { int?: boolean; positive?: boolean; min?: number }) => {
  // Preprocess anything into a number (or undefined to trigger "required")
  let schema = z.preprocess((v) => {
    if (v === null || v === undefined) return undefined;
    if (typeof v === "number") return v;

    if (typeof v === "string") {
      const t = v.trim();
      if (t === "") return undefined;              // empty string => required error
      const n = Number(t.replace(",", "."));       // tolerate "12,5"
      return Number.isFinite(n) ? n : NaN;         // NaN triggers number error
    }

    return v; // let z.number() complain if it's not numeric
  }, z.number());

  // Attach numeric constraints via refine (available on ZodEffects)
  if (opts?.int) {
    schema = schema.refine((n) => Number.isInteger(n), { message: "must be an integer" });
  }
  if (opts?.positive) {
    schema = schema.refine((n) => n > 0, { message: "must be > 0" });
  }
  if (typeof opts?.min === "number") {
    const min = opts.min;
    schema = schema.refine((n) => n >= min, { message: `must be ≥ ${min}` });
  }

  return schema;
};

export const QuoteCreateSchema = z.object({
  quote_no: z.string().min(1, "quote_no required"),
  customer_name: z.string().min(1, "customer_name required"),
  email: z
    .string()
    .email("invalid email")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  phone: z.string().optional(),
});

const CavitySchema = z.object({
  count: coerceNumber({ int: true, min: 1 }).default(1),
  l: coerceNumber({ positive: true }),
  w: coerceNumber({ positive: true }),
  d: coerceNumber({ positive: true }),
});

export const QuoteItemInputSchema = z.object({
  length_in: coerceNumber({ positive: true }),
  width_in: coerceNumber({ positive: true }),
  height_in: coerceNumber({ positive: true }),
  material_id: coerceNumber({ int: true, positive: true }),
  qty: coerceNumber({ int: true, min: 1 }).default(1),
  cavities: z.array(CavitySchema).default([]),
  round_to_bf: coerceNumber({ positive: true }).optional(),
});

export type QuoteCreateInput = z.infer<typeof QuoteCreateSchema>;
export type QuoteItemInput = z.infer<typeof QuoteItemInputSchema>;
