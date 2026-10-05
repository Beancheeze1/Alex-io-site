-- 024_material_61_family.sql
--
-- Data fix: material 61 "PU Ether 1030" (polyether polyurethane foam,
-- 1.30 pcf) was filed under material_family = 'Polyethylene'. It belongs
-- with the other urethanes (ids 4 and 62) in 'Polyurethane Foam'.
--
-- Guarded on id + name + current family, so it only ever changes that one
-- row, and only if it still has the wrong value. Safe to run multiple times.

UPDATE public.materials
SET material_family = 'Polyurethane Foam'
WHERE id = 61
  AND name = 'PU Ether 1030'
  AND material_family = 'Polyethylene';
