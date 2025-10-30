// lib/pricebook/schema.ts
import { z } from 'zod';


export const PriceRule = z.object({
id: z.string().uuid(),
applies_to: z.enum(['material','product','cavity']),
metric: z.enum(['per_cu_in','flat','tiered']),
formula: z.union([z.string(), z.record(z.any())]).optional(),
});


export const Material = z.object({
id: z.string().uuid(),
name: z.string().min(1),
density_lb_ft3: z.number().positive().optional(),
supplier_code: z.string().optional(),
});


export const Cavity = z.object({
id: z.string().uuid(),
shape: z.enum(['rect','cyl','custom']),
dims: z.object({
x: z.number().nonnegative().optional(),
y: z.number().nonnegative().optional(),
z: z.number().nonnegative().optional(),
r: z.number().nonnegative().optional(),
}).partial(),
volume_ci: z.number().nonnegative(),
notes: z.string().optional(),
});


export const Product = z.object({
id: z.string().uuid(),
sku: z.string().min(1),
description: z.string().optional(),
dims: z.object({ x: z.number(), y: z.number(), z: z.number() }),
volume_ci: z.number().nonnegative(),
material_ref: z.string().uuid().optional(),
rule_ref: z.string().uuid().optional(),
});


export const PriceBook = z.object({
name: z.string().min(1),
version: z.string().default('1.0.0'),
currency: z.string().length(3).default('USD'),
created_at: z.string().datetime().optional(),
notes: z.string().optional(),
tables: z.object({
materials: z.array(Material).default([]),
cavities: z.array(Cavity).default([]),
price_rules: z.array(PriceRule).default([]),
products: z.array(Product).default([]),
}),
});


export type PriceBookT = z.infer<typeof PriceBook>;