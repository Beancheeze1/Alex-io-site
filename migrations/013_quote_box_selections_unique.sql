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
-- Run this SELECT first and resolve any duplicates manually (decide which
-- row to keep, delete the other) before running the ALTER TABLE below —
-- it will fail if duplicates exist.
--
-- select quote_id, box_id, count(*), array_agg(id order by id) as ids
-- from public.quote_box_selections
-- group by quote_id, box_id
-- having count(*) > 1;

alter table public.quote_box_selections
  add constraint quote_box_selections_quote_id_box_id_key unique (quote_id, box_id);
