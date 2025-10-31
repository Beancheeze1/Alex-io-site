// lib/validators.ts
import { z } from "zod";

export const QuoteCreateSchema = z.object({
  quote_no: z.string().min(1),
  customer_name: z.string().min(1),
  email: z.string().email().optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().optional(),
});

const CavitySchema = z.object({
  count: z.coerce.number().int().min(1).default(1),
  l: z.coerce.number().positive(),
  w: z.coerce.number().positive(),
  d: z.coerce.number().positive(),
});

export const QuoteItemInputSchema = z.object({
  length_in: z.coerce.number().positive(),
  width_in: z.coerce.number().positive(),
  height_in: z.coerce.number().positive(),
  material_id: z.coerce.number().int().positive(),
  qty: z.coerce.number().int().min(1).default(1),
  cavities: z.array(CavitySchema).default([]),
  round_to_bf: z.coerce.number().positive().optional(),
});

export type QuoteCreateInput = z.infer<typeof QuoteCreateSchema>;
export type QuoteItemInput = z.infer<typeof QuoteItemInputSchema>;
