-- 013_quote_box_selections_unique.sql
--
-- Enforces one carton-selection row per (quote_id, box_id). The app already
-- does a check-then-upsert (SELECT existing row, else INSERT) in
-- app/api/boxes/add-to-quote/route.ts, but that has a race window: two
-- concurrent requests can both miss the SELECT and both INSERT, producing
-- duplicate rows. This constraint makes that impossible at the DB level;
-- the route now handles the resulting 23505 unique-violation by falling
-- back to an UPDATE.
--
-- Idempotent (2026-10-04): production had this applied by hand without a
-- schema_migrations row, so the runner re-ran it and failed. The constraint
-- is now only added when neither the constraint nor a relation (index) with
-- that name exists.
--
-- If the constraint is missing, resolve any duplicates first or the ALTER
-- will fail:
--
-- select quote_id, box_id, count(*), array_agg(id order by id) as ids
-- from public.quote_box_selections
-- group by quote_id, box_id
-- having count(*) > 1;

do $$
begin
  if not exists (
       select 1 from pg_constraint
       where conname = 'quote_box_selections_quote_id_box_id_key'
     )
     and not exists (
       select 1 from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'quote_box_selections_quote_id_box_id_key'
     )
  then
    alter table public.quote_box_selections
      add constraint quote_box_selections_quote_id_box_id_key unique (quote_id, box_id);
  end if;
end $$;
