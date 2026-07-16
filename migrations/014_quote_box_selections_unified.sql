-- 014_quote_box_selections_unified.sql
--
-- Unifies quote_box_selections to represent both real stock-catalog carton
-- selections and customer/rep-typed custom box sizes as one first-class
-- concept, instead of treating "custom" as an ephemeral facts-only value
-- (customer_box_in) that lived outside this table and got recomputed live
-- on every render.
--
-- Adds:
--   kind                                   'stock' | 'custom'
--   custom_length_in / custom_width_in / custom_height_in / custom_style
--                                           only populated for kind='custom'
--   description                            frozen at write time (was
--                                           computed live before)
--
-- box_id and sku become nullable: only 'stock' rows use them.
--
-- Existing rows have only ever represented real stock selections (this
-- table predates the custom-entry concept entirely), so they backfill
-- safely to kind='stock'.
--
-- The CHECK constraint enforces, at the DB level, that a row is exactly
-- one of the two shapes — never both, never neither:
--   stock:  box_id IS NOT NULL, all four custom_* columns NULL
--   custom: box_id IS NULL, all four custom_* columns NOT NULL

alter table public.quote_box_selections
  add column kind text not null default 'stock',
  add column custom_length_in numeric,
  add column custom_width_in numeric,
  add column custom_height_in numeric,
  add column custom_style text,
  add column description text;

update public.quote_box_selections set kind = 'stock' where kind is null;

alter table public.quote_box_selections
  alter column box_id drop not null,
  alter column sku drop not null;

alter table public.quote_box_selections
  add constraint quote_box_selections_kind_check
  check (kind in ('stock', 'custom'));

alter table public.quote_box_selections
  add constraint quote_box_selections_kind_shape_check
  check (
    (
      kind = 'stock'
      and box_id is not null
      and custom_length_in is null
      and custom_width_in is null
      and custom_height_in is null
      and custom_style is null
    )
    or
    (
      kind = 'custom'
      and box_id is null
      and custom_length_in is not null
      and custom_width_in is not null
      and custom_height_in is not null
      and custom_style is not null
    )
  );
