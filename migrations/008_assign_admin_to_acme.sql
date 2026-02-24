-- 008_assign_admin_to_acme.sql
-- Path A: assign the admin user to the acme tenant.

update public.users
set tenant_id = (select id from public.tenants where slug = 'acme')
where email = '25thhourdesign@gmail.com';