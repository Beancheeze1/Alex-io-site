// lib/pricebook/sql.ts
export const DDL = `
CREATE TABLE IF NOT EXISTS price_books (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  density_lb_ft3 DOUBLE PRECISION,
  supplier_code TEXT
);

CREATE TABLE IF NOT EXISTS cavities (
  id UUID PRIMARY KEY,
  shape TEXT NOT NULL,
  dims JSONB NOT NULL DEFAULT '{}'::jsonb,
  volume_ci DOUBLE PRECISION NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS price_rules (
  id UUID PRIMARY KEY,
  applies_to TEXT NOT NULL,
  metric TEXT NOT NULL,
  formula JSONB
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY,
  sku TEXT NOT NULL,
  description TEXT,
  dims JSONB NOT NULL,
  volume_ci DOUBLE PRECISION NOT NULL,
  material_ref UUID REFERENCES materials(id) ON DELETE SET NULL,
  rule_ref UUID REFERENCES price_rules(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_products_material_ref ON products(material_ref);
CREATE INDEX IF NOT EXISTS idx_products_rule_ref ON products(rule_ref);
`;

export const UPSERT_MATERIAL = `
INSERT INTO materials (id, name, density_lb_ft3, supplier_code)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  density_lb_ft3 = EXCLUDED.density_lb_ft3,
  supplier_code = EXCLUDED.supplier_code
`;

export const UPSERT_CAVITY = `
INSERT INTO cavities (id, shape, dims, volume_ci, notes)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (id) DO UPDATE SET
  shape = EXCLUDED.shape,
  dims = EXCLUDED.dims,
  volume_ci = EXCLUDED.volume_ci,
  notes = EXCLUDED.notes
`;

export const UPSERT_RULE = `
INSERT INTO price_rules (id, applies_to, metric, formula)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id) DO UPDATE SET
  applies_to = EXCLUDED.applies_to,
  metric = EXCLUDED.metric,
  formula = EXCLUDED.formula
`;

export const UPSERT_PRODUCT = `
INSERT INTO products (id, sku, description, dims, volume_ci, material_ref, rule_ref)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE SET
  sku = EXCLUDED.sku,
  description = EXCLUDED.description,
  dims = EXCLUDED.dims,
  volume_ci = EXCLUDED.volume_ci,
  material_ref = EXCLUDED.material_ref,
  rule_ref = EXCLUDED.rule_ref
`;
