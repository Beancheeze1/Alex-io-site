-- 025_corrugated_settings.sql
--
-- Per-shop corrugated settings (Admin -> Corrugated). Spec: "Custom
-- Corrugated Box Pricing - Spec v1".
--   corrugated_settings      one row per tenant: run/print rates + layout choices
--   corrugated_flutes        per tenant, per flute: caliper + scoring allowances
--   corrugated_board_grades  per tenant: grades the shop runs, cost per MSF
--
-- Rows are seeded per tenant in code (lib/corrugated.ts,
-- ensureCorrugatedDefaults) the first time the settings are read, so tenants
-- created later get defaults too. This migration only creates the tables.
--
-- Safe to run multiple times (IF NOT EXISTS / DROP ... IF EXISTS).

CREATE TABLE IF NOT EXISTS public.corrugated_settings (
  tenant_id                  integer        PRIMARY KEY,
  waste_pct                  numeric(7,3)   NOT NULL DEFAULT 10,
  order_setup_usd            numeric(12,4)  NOT NULL DEFAULT 0,
  converting_per_m           numeric(12,4)  NOT NULL DEFAULT 0,
  plate_spot_usd             numeric(12,4)  NOT NULL DEFAULT 0,
  plate_flood_usd            numeric(12,4)  NOT NULL DEFAULT 0,
  print_setup_per_color_usd  numeric(12,4)  NOT NULL DEFAULT 0,
  print_run_spot_per_m       numeric(12,4)  NOT NULL DEFAULT 0,
  print_run_flood_per_m      numeric(12,4)  NOT NULL DEFAULT 0,
  markup_pct                 numeric(8,3)   NOT NULL DEFAULT 0,
  min_order_usd              numeric(12,2)  NOT NULL DEFAULT 0,
  joint_type                 text           NOT NULL DEFAULT 'glued',
  flap_pct                   numeric(6,3)   NOT NULL DEFAULT 50,
  round_to_in                numeric(8,5)   NOT NULL DEFAULT 0.0625,
  edge_trim_in               numeric(8,5)   NOT NULL DEFAULT 0,
  created_at                 timestamptz    NOT NULL DEFAULT now(),
  updated_at                 timestamptz    NOT NULL DEFAULT now()
);

ALTER TABLE public.corrugated_settings DROP CONSTRAINT IF EXISTS corrugated_settings_joint_type_check;
ALTER TABLE public.corrugated_settings ADD CONSTRAINT corrugated_settings_joint_type_check
  CHECK (joint_type IN ('glued', 'stitched', 'taped'));

CREATE TABLE IF NOT EXISTS public.corrugated_flutes (
  id                 bigserial     PRIMARY KEY,
  tenant_id          integer       NOT NULL,
  flute              text          NOT NULL,
  caliper_in         numeric(8,5)  NOT NULL,
  panel_allow_in     numeric(8,5)  NOT NULL,
  last_panel_adj_in  numeric(8,5)  NOT NULL DEFAULT 0,
  depth_allow_in     numeric(8,5)  NOT NULL,
  flap_allow_in      numeric(8,5)  NOT NULL,
  glue_joint_in      numeric(8,5)  NOT NULL,
  sort_order         integer       NOT NULL DEFAULT 0,
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT corrugated_flutes_tenant_flute_key UNIQUE (tenant_id, flute)
);

CREATE TABLE IF NOT EXISTS public.corrugated_board_grades (
  id            bigserial      PRIMARY KEY,
  tenant_id     integer        NOT NULL,
  name          text           NOT NULL,
  flute         text           NOT NULL,
  ect_label     text           NOT NULL DEFAULT '',
  cost_per_msf  numeric(12,4),
  active        boolean        NOT NULL DEFAULT true,
  is_default    boolean        NOT NULL DEFAULT false,
  sort_order    integer        NOT NULL DEFAULT 0,
  created_at    timestamptz    NOT NULL DEFAULT now(),
  updated_at    timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT corrugated_board_grades_tenant_name_key UNIQUE (tenant_id, name)
);

-- At most one default grade per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS corrugated_board_grades_one_default
  ON public.corrugated_board_grades (tenant_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS corrugated_board_grades_tenant_sort_idx
  ON public.corrugated_board_grades (tenant_id, sort_order);
