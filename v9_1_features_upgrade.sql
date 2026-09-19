-- Cash Register X Automatic V9.1 feature upgrade
-- Adds POS button shapes and PWD 20% discount tracking.
-- Removes Customers from the APPLICATION only; the customers table is intentionally kept so existing data is not destroyed.

-- Product button shape
alter table public.products add column if not exists pos_shape text default 'box';
update public.products set pos_shape='box' where pos_shape is null or trim(pos_shape)='';

-- Keep only supported values.
do $$ begin
  if not exists (select 1 from pg_constraint where conname='products_pos_shape_check') then
    alter table public.products add constraint products_pos_shape_check
      check (pos_shape in ('circle','box','triangle','hexagon'));
  end if;
exception when duplicate_object then null; end $$;

-- Track whether the recorded discount was the fixed PWD 20% option.
alter table public.sales add column if not exists pwd_discount boolean not null default false;

-- Categories/products are visible to Staff for POS/Inventory, but only Admin can create/edit/delete them.
-- Inventory remains available to Staff.
drop policy if exists categories_staff_admin on public.categories;
drop policy if exists categories_all_authenticated on public.categories;
create policy categories_read_authenticated on public.categories
for select to authenticated using (true);
create policy categories_admin_insert on public.categories
for insert to authenticated
with check (public.current_user_role()='admin');
create policy categories_admin_update on public.categories
for update to authenticated
using (public.current_user_role()='admin')
with check (public.current_user_role()='admin');
create policy categories_admin_delete on public.categories
for delete to authenticated
using (public.current_user_role()='admin');

drop policy if exists products_staff_admin on public.products;
drop policy if exists products_all_authenticated on public.products;
create policy products_read_staff_admin on public.products
for select to authenticated using (public.current_user_role() in ('admin','staff','manager'));
create policy products_admin_insert on public.products
for insert to authenticated
with check (public.current_user_role()='admin');
create policy products_admin_update on public.products
for update to authenticated
using (public.current_user_role()='admin')
with check (public.current_user_role()='admin');
create policy products_admin_delete on public.products
for delete to authenticated
using (public.current_user_role()='admin');

-- No customer feature is used by the updated app. Existing customer data is preserved.

select 'V9.1 feature upgrade completed.' as result;
