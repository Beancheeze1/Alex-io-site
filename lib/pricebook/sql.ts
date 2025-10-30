// lib/pricebook/sql.ts

// 1) Base table creation (idempotent)
export const CREATE_TABLES: string[] = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,

  `CREATE TABLE IF NOT EXISTS price_books (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    currency TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS materials (
    -- legacy integer id may exist; we don't alter it.
    id INTEGER,
    name TEXT NOT NULL,
    density_lb_ft3 NUMERIC,
    price_per_bf NUMERIC,
    supplier_code TEXT,
    material_uid UUID DEFAULT gen_random_uuid(),  -- app-owned UUID
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE
  );`,

  `CREATE TABLE IF NOT EXISTS price_rules (
    -- legacy schema may have only sku; we extend below
    sku TEXT NOT NULL,
    rule_uid UUID DEFAULT gen_random_uuid()       -- app-owned UUID
  );`,

  `CREATE TABLE IF NOT EXISTS cavities (
    id UUID PRIMARY KEY,
    shape TEXT NOT NULL,
    dims JSONB NOT NULL DEFAULT '{}'::jsonb,
    volume_ci DOUBLE PRECISION NOT NULL DEFAULT 0
  );`,

  `CREATE TABLE IF NOT EXISTS products (
    -- legacy integer id; keep as-is
    id INTEGER,
    name TEXT,
    sku TEXT NOT NULL,
    description TEXT,
    dims JSONB DEFAULT '{}'::jsonb,
    base_height_in NUMERIC DEFAULT 1,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    material_ref UUID,
    rule_ref UUID,
    volume_ci DOUBLE PRECISION DEFAULT 0
  );`,
];

// 2) Ensure columns exist / coerce types (safe, guarded)
export const ALTER_COLUMNS: string[] = [
  // --- materials (ensure app UUID + indexes and common columns)
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS material_uid UUID;`,
  `ALTER TABLE materials ALTER COLUMN material_uid SET DEFAULT gen_random_uuid();`,
  `UPDATE materials SET material_uid = gen_random_uuid() WHERE material_uid IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_materials_material_uid ON materials(material_uid);`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS supplier_code TEXT;`,
  `ALTER TABLE materials ADD COLUMN IF NOT EXISTS density_lb_ft3 NUMERIC;`,

  // --- price_rules: add modern columns we use
  `ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS rule_uid UUID;`,
  `ALTER TABLE price_rules ALTER COLUMN rule_uid SET DEFAULT gen_random_uuid();`,
  `UPDATE price_rules SET rule_uid = gen_random_uuid() WHERE rule_uid IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_price_rules_rule_uid ON price_rules(rule_uid);`,
  `ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS applies_to TEXT;`,
  `ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS metric TEXT;`,
  `ALTER TABLE price_rules ADD COLUMN IF NOT EXISTS formula JSONB;`,

  // --- products: make sure columns we export/use exist with right types
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS dims JSONB DEFAULT '{}'::jsonb;`,
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name='products' AND column_name='dims' AND data_type <> 'jsonb'
     ) THEN
       ALTER TABLE products
         ALTER COLUMN dims TYPE JSONB
         USING CASE WHEN jsonb_typeof(dims) IS NULL THEN '{}'::jsonb ELSE dims::jsonb END;
     END IF;
   END $$;`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS material_ref UUID;`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS rule_ref UUID;`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_ci DOUBLE PRECISION DEFAULT 0;`,
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name='products' AND column_name='volume_ci' AND data_type <> 'double precision'
     ) THEN
       ALTER TABLE products
         ALTER COLUMN volume_ci TYPE DOUBLE PRECISION
         USING NULLIF(trim(volume_ci::text), '')::double precision;
     END IF;
   END $$;`,

  // --- cavities: ensure dims + volume_ci are correct
  `ALTER TABLE cavities ADD COLUMN IF NOT EXISTS dims JSONB DEFAULT '{}'::jsonb;`,
  `ALTER TABLE cavities ADD COLUMN IF NOT EXISTS volume_ci DOUBLE PRECISION DEFAULT 0;`,
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name='cavities' AND column_name='dims' AND data_type <> 'jsonb'
     ) THEN
       ALTER TABLE cavities
         ALTER COLUMN dims TYPE JSONB
         USING CASE WHEN jsonb_typeof(dims) IS NULL THEN '{}'::jsonb ELSE dims::jsonb END;
     END IF;
   END $$;`,
];

// 3) Clean invalid refs (now that we use UUID UIDs)
export const CLEAN_INVALID: string[] = [
  `UPDATE products p
     SET material_ref = NULL
   WHERE material_ref IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM materials m WHERE m.material_uid = p.material_ref);`,

  `UPDATE products p
     SET rule_ref = NULL
   WHERE rule_ref IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM price_rules r WHERE r.rule_uid = p.rule_ref);`,
];

// 4) FKs (NOT VALID; attempt validate)
export const ADD_FKS: string[] = [
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_material_ref_fkey') THEN
       ALTER TABLE products
         ADD CONSTRAINT products_material_ref_fkey
         FOREIGN KEY (material_ref) REFERENCES materials(material_uid) ON DELETE SET NULL NOT VALID;
       BEGIN
         ALTER TABLE products VALIDATE CONSTRAINT products_material_ref_fkey;
       EXCEPTION WHEN others THEN NULL; END;
     END IF;
   END$$;`,

  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='products_rule_ref_fkey') THEN
       ALTER TABLE products
         ADD CONSTRAINT products_rule_ref_fkey
         FOREIGN KEY (rule_ref) REFERENCES price_rules(rule_uid) ON DELETE SET NULL NOT VALID;
       BEGIN
         ALTER TABLE products VALIDATE CONSTRAINT products_rule_ref_fkey;
       EXCEPTION WHEN others THEN NULL; END;
     END IF;
   END$$;`,
];

// 5) Indexes
export const CREATE_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_products_material_ref ON products(material_ref);`,
  `CREATE INDEX IF NOT EXISTS idx_products_rule_ref ON products(rule_ref);`,
];

// 6) Upsert helpers (use app-owned UUIDs)
export const UPSERT_MATERIAL = `
INSERT INTO materials (material_uid, name, density_lb_ft3, supplier_code)
VALUES ($1, $2, $3, $4)
ON CONFLICT (material_uid) DO UPDATE SET
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
INSERT INTO price_rules (rule_uid, applies_to, metric, formula)
VALUES ($1, $2, $3, $4)
ON CONFLICT (rule_uid) DO UPDATE SET
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
