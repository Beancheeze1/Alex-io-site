// lib/pricebook/sql.ts

// Run these statements sequentially (not as one big string)

export const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS price_books (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    currency TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS materials (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    density_lb_ft3 DOUBLE PRECISION,
    supplier_code TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS cavities (
    id UUID PRIMARY KEY,
    shape TEXT NOT NULL,
    dims JSONB NOT NULL DEFAULT '{}'::jsonb,
    volume_ci DOUBLE PRECISION NOT NULL,
    notes TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS price_rules (
    id UUID PRIMARY KEY,
    applies_to TEXT NOT NULL,
    metric TEXT NOT NULL,
    formula JSONB
  );`,

  `CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY,
    sku TEXT NOT NULL,
    description TEXT,
    dims JSONB NOT NULL,
    volume_ci DOUBLE PRECISION NOT NULL
    -- material_ref, rule_ref added below via ALTER IF NOT EXISTS
  );`,
];

// Ensure new columns exist (safe to run many times)
export const ALTER_COLUMNS: string[] = [
  // products.dims (in case older table had different type)
  `ALTER TABLE products
     ALTER COLUMN dims TYPE JSONB
     USING CASE WHEN jsonb_typeof(dims) IS NULL THEN '{}'::jsonb ELSE dims::jsonb END;`,

  // Add the two FK columns if missing
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS material_ref UUID;`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS rule_ref UUID;`,

  // cavities.dims to JSONB (older tables may be TEXT)
  `ALTER TABLE cavities
     ALTER COLUMN dims TYPE JSONB
     USING CASE WHEN jsonb_typeof(dims) IS NULL THEN '{}'::jsonb ELSE dims::jsonb END;`,
];

// Add FKs only once
export const ADD_FKS: string[] = [
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_material_ref_fkey') THEN
       ALTER TABLE products
         ADD CONSTRAINT products_material_ref_fkey
         FOREIGN KEY (material_ref) REFERENCES materials(id) ON DELETE SET NULL;
     END IF;
   END$$;`,

  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_rule_ref_fkey') THEN
       ALTER TABLE products
         ADD CONSTRAINT products_rule_ref_fkey
         FOREIGN KEY (rule_ref) REFERENCES price_rules(id) ON DELETE SET NULL;
     END IF;
   END$$;`,
];

// Create indexes (guarded)
export const CREATE_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_products_material_ref ON products(material_ref);`,
  `CREATE INDEX IF NOT EXISTS idx_products_rule_ref ON products(rule_ref);`,
];

// Upsert helpers (unchanged)
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
