-- Cash Register X Automatic V9.1
-- MASTER DATABASE FIX
-- Run this ONE file in Supabase SQL Editor for the existing CRX database.
-- Safe/idempotent: uses IF NOT EXISTS / DROP POLICY and does not delete business data.

-- ============================================================
-- 1) Required V9.1 columns
-- ============================================================
alter table public.profiles add column if not exists username text;
alter table public.products add column if not exists pos_shape text default 'box';
alter table public.stocks add column if not exists unit text default 'pcs';
alter table public.stocks add column if not exists quantity numeric(12,3) default 0;
alter table public.stocks add column if not exists low_limit numeric(12,3) default 3;
alter table public.sale_items add column if not exists quantity numeric(12,3) default 1;
alter table public.sale_items add column if not exists unit_price numeric(12,2) default 0;
alter table public.sale_items add column if not exists line_total numeric(12,2) default 0;
alter table public.sale_items add column if not exists created_at timestamptz default now();
alter table public.expenses add column if not exists expense_date date default current_date;
alter table public.expenses add column if not exists category text;
alter table public.expenses add column if not exists description text;
alter table public.expenses add column if not exists amount numeric(12,2) default 0;
alter table public.expenses add column if not exists payment_method text default 'Cash';
alter table public.expenses add column if not exists reference_no text;
alter table public.expenses add column if not exists added_by uuid;
alter table public.expenses add column if not exists created_at timestamptz default now();
alter table public.sales add column if not exists pwd_discount boolean not null default false;
alter table public.sales add column if not exists order_number text;

-- Make inventory quantities support kg/decimal quantities.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='stocks' and column_name='quantity' and data_type='integer') then
    alter table public.stocks alter column quantity type numeric(12,3) using quantity::numeric;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='stocks' and column_name='low_limit' and data_type='integer') then
    alter table public.stocks alter column low_limit type numeric(12,3) using low_limit::numeric;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sale_items' and column_name='quantity' and data_type='integer') then
    alter table public.sale_items alter column quantity type numeric(12,3) using quantity::numeric;
  end if;
end $$;

update public.products set pos_shape='box' where pos_shape is null or trim(pos_shape)='';
update public.stocks set quantity=0 where quantity is null;
update public.stocks set low_limit=3 where low_limit is null;
update public.expenses set expense_date=current_date where expense_date is null;
update public.expenses set amount=0 where amount is null;

-- ============================================================
-- 2) Product button-shape validation
-- ============================================================
alter table public.products drop constraint if exists products_pos_shape_check;
DO $$ BEGIN
  alter table public.products add constraint products_pos_shape_check
    check (pos_shape in ('circle','box','triangle','hexagon'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 3) Ensure the sale_items -> sales FK is the correct relationship
-- ============================================================
-- The CRX POS always saves the parent sale first and then uses its real ID.
-- This constraint must point to public.sales(id), not an old/legacy table.
do $$
declare
  ref_table text;
begin
  select n.nspname||'.'||c.relname
    into ref_table
  from pg_constraint fk
  join pg_class c on c.oid=fk.confrelid
  join pg_namespace n on n.oid=c.relnamespace
  where fk.conname='sale_items_sale_id_fkey'
    and fk.conrelid='public.sale_items'::regclass;

  if ref_table is not null and ref_table <> 'public.sales' then
    alter table public.sale_items drop constraint sale_items_sale_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname='sale_items_sale_id_fkey'
      and conrelid='public.sale_items'::regclass
  ) then
    alter table public.sale_items
      add constraint sale_items_sale_id_fkey
      foreign key (sale_id) references public.sales(id) on delete cascade;
  end if;
end $$;

-- Product FK is optional because POS can retain the product name even if a product is later deleted.
do $$ begin
  if not exists (select 1 from pg_constraint where conname='sale_items_product_id_fkey' and conrelid='public.sale_items'::regclass) then
    alter table public.sale_items add constraint sale_items_product_id_fkey
      foreign key (product_id) references public.products(id) on delete set null;
  end if;
exception when duplicate_object then null; end $$;

-- ============================================================
-- 4) Username login
-- ============================================================
update public.profiles
set username=lower(split_part(email,'@',1))
where (username is null or trim(username)='')
  and email is not null
  and split_part(email,'@',1)<>'';

create unique index if not exists profiles_username_lower_idx
on public.profiles(lower(username));

create or replace function public.get_login_email(p_username text)
returns text
language sql
stable
security definer
set search_path=public
as $$
  select email
  from public.profiles
  where lower(username)=lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.get_login_email(text) from public;
grant execute on function public.get_login_email(text) to anon, authenticated;

-- ============================================================
-- 5) Admin / Staff role helper
-- ============================================================
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path=public
as $$
  select coalesce((select role from public.profiles where id=auth.uid()),'staff');
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

update public.profiles set role='staff' where role is null or role not in ('admin','staff');

-- ============================================================
-- 6) RLS policies matching the V9.1 application
--    Customers are intentionally NOT exposed by the application.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.stocks enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.expenses enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_authenticated on public.profiles
for select to authenticated using (true);
create policy profiles_update_own on public.profiles
for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

drop policy if exists categories_all_authenticated on public.categories;
drop policy if exists categories_staff_admin on public.categories;
drop policy if exists categories_read_authenticated on public.categories;
drop policy if exists categories_admin_insert on public.categories;
drop policy if exists categories_admin_update on public.categories;
drop policy if exists categories_admin_delete on public.categories;
create policy categories_read_authenticated on public.categories
for select to authenticated using (true);
create policy categories_admin_insert on public.categories
for insert to authenticated with check (public.current_user_role()='admin');
create policy categories_admin_update on public.categories
for update to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
create policy categories_admin_delete on public.categories
for delete to authenticated using (public.current_user_role()='admin');

drop policy if exists products_all_authenticated on public.products;
drop policy if exists products_staff_admin on public.products;
drop policy if exists products_read_staff_admin on public.products;
drop policy if exists products_admin_insert on public.products;
drop policy if exists products_admin_update on public.products;
drop policy if exists products_admin_delete on public.products;
create policy products_read_staff_admin on public.products
for select to authenticated using (public.current_user_role() in ('admin','staff','manager'));
create policy products_admin_insert on public.products
for insert to authenticated with check (public.current_user_role()='admin');
create policy products_admin_update on public.products
for update to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
create policy products_admin_delete on public.products
for delete to authenticated using (public.current_user_role()='admin');

drop policy if exists stocks_all_authenticated on public.stocks;
drop policy if exists stocks_staff_admin on public.stocks;
create policy stocks_staff_admin on public.stocks
for all to authenticated
using (public.current_user_role() in ('admin','staff'))
with check (public.current_user_role() in ('admin','staff'));

drop policy if exists sales_all_authenticated on public.sales;
drop policy if exists sales_read_authenticated on public.sales;
drop policy if exists sales_insert_staff_admin on public.sales;
drop policy if exists sales_update_admin on public.sales;
drop policy if exists sales_delete_admin on public.sales;
create policy sales_read_authenticated on public.sales
for select to authenticated using (true);
create policy sales_insert_staff_admin on public.sales
for insert to authenticated with check (public.current_user_role() in ('admin','staff'));
create policy sales_update_admin on public.sales
for update to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
create policy sales_delete_admin on public.sales
for delete to authenticated using (public.current_user_role()='admin');

drop policy if exists sale_items_all_authenticated on public.sale_items;
drop policy if exists sale_items_read_authenticated on public.sale_items;
drop policy if exists sale_items_insert_staff_admin on public.sale_items;
drop policy if exists sale_items_update_admin on public.sale_items;
drop policy if exists sale_items_delete_admin on public.sale_items;
create policy sale_items_read_authenticated on public.sale_items
for select to authenticated using (true);
create policy sale_items_insert_staff_admin on public.sale_items
for insert to authenticated with check (public.current_user_role() in ('admin','staff'));
create policy sale_items_update_admin on public.sale_items
for update to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
create policy sale_items_delete_admin on public.sale_items
for delete to authenticated using (public.current_user_role()='admin');

drop policy if exists expenses_all_authenticated on public.expenses;
drop policy if exists expenses_read_authenticated on public.expenses;
drop policy if exists expenses_insert_admin on public.expenses;
drop policy if exists expenses_update_admin on public.expenses;
drop policy if exists expenses_delete_admin on public.expenses;
drop policy if exists expenses_insert_staff_admin on public.expenses;
drop policy if exists expenses_update_staff_admin on public.expenses;
drop policy if exists expenses_delete_staff_admin on public.expenses;
create policy expenses_read_authenticated on public.expenses
for select to authenticated using (true);
create policy expenses_insert_staff_admin on public.expenses
for insert to authenticated with check (public.current_user_role() in ('admin','staff'));
create policy expenses_update_staff_admin on public.expenses
for update to authenticated using (public.current_user_role() in ('admin','staff')) with check (public.current_user_role() in ('admin','staff'));
create policy expenses_delete_staff_admin on public.expenses
for delete to authenticated using (public.current_user_role() in ('admin','staff'));

-- ============================================================
-- 7) Helpful indexes
-- ============================================================
create index if not exists sales_sale_date_idx on public.sales(sale_date);
create index if not exists sales_created_at_idx on public.sales(created_at);
create index if not exists sales_order_number_idx on public.sales(sale_date, order_number);
create index if not exists sale_items_sale_idx on public.sale_items(sale_id);
create index if not exists sale_items_product_idx on public.sale_items(product_id);
create index if not exists expenses_date_idx on public.expenses(expense_date);
create index if not exists stocks_product_idx on public.stocks(product_id);
create index if not exists products_category_idx on public.products(category_id);

-- ============================================================
-- 8) Final diagnostic: should return zero orphan sale items.
-- ============================================================
select count(*) as orphan_sale_items
from public.sale_items si
left join public.sales s on s.id=si.sale_id
where s.id is null;

select 'CRX V9.1 master database fix completed.' as result;
