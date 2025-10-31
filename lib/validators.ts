// lib/validators.ts
import { z } from "zod";

export const QuoteIdParam = z.object({
  id: z.coerce.number().int().positive(), // <- numeric DB id, not UUID
});

export const QuoteItemBody = z.object({
  length_in: z.coerce.number().positive(),
  width_in: z.coerce.number().positive(),
  height_in: z.coerce.number().positive(),
  material_id: z.coerce.number().int().positive(),
  qty: z.coerce.number().int().positive().default(1),
  round_to_bf: z.coerce.number().positive().default(0.10),
  cavities: z
    .array(
      z.object({
        count: z.coerce.number().int().positive().default(1),
        l: z.coerce.number().positive(),
        w: z.coerce.number().positive(),
        d: z.coerce.number().positive(),
      })
    )
    .default([]),
});

export const RepriceBody = QuoteItemBody; // same shape
