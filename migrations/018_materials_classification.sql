-- 018_materials_classification.sql
--
-- Adds real materials classification metadata, sourced primarily from
-- Amcon's own published per-product Type tables (amconfoam.com/materials/*)
-- and cross-validated against manufacturer-stated intended use (JSP
-- ARPRO/ARPAK industry spec reference for the EPP/EPE family). This gates
-- which materials the cushion-curve recommendation engine is allowed to
-- suggest for packaging/cushioning use -- e.g. reticulated PU (open-cell,
-- membranes removed) is a real, structurally distinct filtration/acoustic
-- product, not a cushioning one, even when a curve happens to be on file
-- for it.
--
-- Defaults are the SAFE/unconfirmed values so nothing is silently
-- reclassified as cushioning-eligible just by this migration running --
-- population is a separate, explicit UPDATE pass (see the classification
-- script run alongside this migration) that only sets 'confirmed'/
-- 'inferred' when there's a real, checkable source to cite.
--
-- Safe to run multiple times (idempotent via IF NOT EXISTS / DROP+ADD
-- CONSTRAINT).

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS application_category text NOT NULL DEFAULT 'unconfirmed';

ALTER TABLE public.materials
  DROP CONSTRAINT IF EXISTS materials_application_category_check;
ALTER TABLE public.materials
  ADD CONSTRAINT materials_application_category_check
  CHECK (application_category IN (
    'packaging_cushioning',
    'seating_comfort',
    'filtration_acoustic',
    'insulation_structural',
    'other',
    'unconfirmed'
  ));

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS cell_structure text NOT NULL DEFAULT 'unconfirmed';

ALTER TABLE public.materials
  DROP CONSTRAINT IF EXISTS materials_cell_structure_check;
ALTER TABLE public.materials
  ADD CONSTRAINT materials_cell_structure_check
  CHECK (cell_structure IN (
    'closed_cell',
    'open_cell',
    'reticulated',
    'unconfirmed'
  ));

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS classification_confidence text NOT NULL DEFAULT 'unconfirmed';

ALTER TABLE public.materials
  DROP CONSTRAINT IF EXISTS materials_classification_confidence_check;
ALTER TABLE public.materials
  ADD CONSTRAINT materials_classification_confidence_check
  CHECK (classification_confidence IN ('confirmed', 'inferred', 'unconfirmed'));

-- Free text: the specific Amcon URL, "JSP industry spec sheet", a
-- combination of both, or NULL when genuinely unresolved. Not an enum --
-- this is meant to be checkable/human-readable provenance, mirroring how
-- cushion_curves.source already works for curve data.
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS classification_source text;

COMMENT ON COLUMN public.materials.application_category IS
  'Real intended-use category, sourced primarily from Amcon''s own '
  'per-product Type classification. packaging_cushioning is the only '
  'value the cushion-curve recommendation engine treats as eligible. '
  'Default unconfirmed -- never silently assumed cushioning-eligible.';
COMMENT ON COLUMN public.materials.cell_structure IS
  'closed_cell | open_cell | reticulated | unconfirmed. Reticulated (cell '
  'membranes removed) is a real, distinct filtration/acoustic-foam '
  'structure -- not a cushioning one, even when curve data exists.';
COMMENT ON COLUMN public.materials.classification_confidence IS
  'confirmed | inferred | unconfirmed -- mirrors the tested/proxy/modeled/'
  'unverified trust hierarchy already used for cushion_curves.provenance.';
COMMENT ON COLUMN public.materials.classification_source IS
  'Where application_category/cell_structure came from: a specific Amcon '
  'materials/* URL, a named reference document, or NULL if unresolved.';
