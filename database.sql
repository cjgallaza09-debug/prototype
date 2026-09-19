-- ============================================================
-- CASH REGISTER X AUTOMATIC - SAFE SUPABASE MIGRATION
-- ============================================================
-- Run this ONCE in Supabase SQL Editor.
-- It is designed for the existing Shawarma Sales Monitoring DB.
-- It does NOT drop your existing tables or delete your data.
-- If an incompatible public.sales table exists without sale_date,
-- it is renamed to public.sales_legacy before the new POS table is made.
-- ============================================================

create extension if not exists pgcrypto;

-- -------------------------
-- Profiles / user roles
-- -------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'staff' check (role in ('admin','manager','staff')),
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists role text default 'staff';
alter table public.profiles add column if not exists created_at timestamptz default now();

-- -------------------------
-- Categories
-- -------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
alter table public.categories add column if not exists name text;
alter table public.categories add column if not exists created_at timestamptz default now();

-- -------------------------
-- Products
-- -------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text,
  category_id uuid,
  price numeric(12,2) default 0,
  cost numeric(12,2) default 0,
  active boolean default true,
  created_at timestamptz default now()
);
alter table public.products add column if not exists name text;
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists category_id uuid;
alter table public.products add column if not exists price numeric(12,2) default 0;
alter table public.products add column if not exists cost numeric(12,2) default 0;
alter table public.products add column if not exists active boolean default true;
alter table public.products add column if not exists created_at timestamptz default now();

-- Add FK only when it is not already present.
do $$ begin
  if not exists (select 1 from pg_constraint where conname='products_category_id_fkey') then
    alter table public.products add constraint products_category_id_fkey
      foreign key (category_id) references public.categories(id) on delete set null;
  end if;
exception when duplicate_object then null; end $$;

-- -------------------------
-- Inventory / stocks
-- -------------------------
create table if not exists public.stocks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid,
  name text,
  quantity numeric(12,3) default 0,
  unit text not null default 'pcs',
  low_limit numeric(12,3) default 3,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
alter table public.stocks add column if not exists product_id uuid;
alter table public.stocks add column if not exists name text;
alter table public.stocks add column if not exists quantity numeric(12,3) default 0;
alter table public.stocks add column if not exists unit text default 'pcs';
alter table public.stocks add column if not exists low_limit numeric(12,3) default 3;

-- Upgrade older integer inventory quantities safely
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='stocks' and column_name='quantity' and data_type='integer') then
    alter table public.stocks alter column quantity type numeric(12,3) using quantity::numeric;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='stocks' and column_name='low_limit' and data_type='integer') then
    alter table public.stocks alter column low_limit type numeric(12,3) using low_limit::numeric;
  end if;
end $$;
alter table public.stocks add column if not exists updated_at timestamptz default now();
alter table public.stocks add column if not exists created_at timestamptz default now();

-- -------------------------
-- Customers
-- -------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  loyalty_points integer default 0,
  created_at timestamptz default now()
);
alter table public.customers add column if not exists name text;
alter table public.customers add column if not exists phone text;
alter table public.customers add column if not exists email text;
alter table public.customers add column if not exists loyalty_points integer default 0;
alter table public.customers add column if not exists created_at timestamptz default now();

-- -------------------------
-- Sales compatibility fix
-- -------------------------
-- Your screenshot showed: column "sale_date" does not exist.
-- Preserve that old table instead of deleting it.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='sales'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='sales' and column_name='sale_date'
  ) then
    alter table public.sales rename to sales_legacy;
  end if;
end $$;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null default current_date,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  payment_method text not null default 'Cash',
  customer_id uuid,
  cashier_id uuid,
  amount_received numeric(12,2) not null default 0,
  change_amount numeric(12,2) not null default 0,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

alter table public.sales add column if not exists sale_date date default current_date;
alter table public.sales add column if not exists subtotal numeric(12,2) default 0;
alter table public.sales add column if not exists discount numeric(12,2) default 0;
alter table public.sales add column if not exists total numeric(12,2) default 0;
alter table public.sales add column if not exists payment_method text default 'Cash';
alter table public.sales add column if not exists customer_id uuid;
alter table public.sales add column if not exists cashier_id uuid;
alter table public.sales add column if not exists amount_received numeric(12,2) default 0;
alter table public.sales add column if not exists change_amount numeric(12,2) default 0;
alter table public.sales add column if not exists status text default 'completed';
alter table public.sales add column if not exists created_at timestamptz default now();

-- -------------------------
-- Sale items
-- -------------------------
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null,
  product_id uuid,
  product_name text not null,
  quantity numeric(12,3) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  created_at timestamptz default now()
);
alter table public.sale_items add column if not exists sale_id uuid;
alter table public.sale_items add column if not exists product_id uuid;
alter table public.sale_items add column if not exists product_name text;
alter table public.sale_items add column if not exists quantity numeric(12,3) default 1;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sale_items' and column_name='quantity' and data_type='integer') then
    alter table public.sale_items alter column quantity type numeric(12,3) using quantity::numeric;
  end if;
end $$;
alter table public.sale_items add column if not exists unit_price numeric(12,2) default 0;
alter table public.sale_items add column if not exists line_total numeric(12,2) default 0;
alter table public.sale_items add column if not exists created_at timestamptz default now();

-- -------------------------
-- Expenses
-- -------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date default current_date,
  category text,
  description text,
  amount numeric(12,2) default 0,
  payment_method text default 'Cash',
  reference_no text,
  added_by uuid,
  created_at timestamptz default now()
);
alter table public.expenses add column if not exists expense_date date default current_date;
alter table public.expenses add column if not exists category text;
alter table public.expenses add column if not exists description text;
alter table public.expenses add column if not exists amount numeric(12,2) default 0;
alter table public.expenses add column if not exists payment_method text default 'Cash';
alter table public.expenses add column if not exists reference_no text;
alter table public.expenses add column if not exists added_by uuid;
alter table public.expenses add column if not exists created_at timestamptz default now();

-- -------------------------
-- Foreign keys
-- -------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname='sales_customer_id_fkey') then
    alter table public.sales add constraint sales_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on delete set null;
  end if;
exception when duplicate_object then null; end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='sales_cashier_id_fkey') then
    alter table public.sales add constraint sales_cashier_id_fkey
      foreign key (cashier_id) references auth.users(id) on delete set null;
  end if;
exception when duplicate_object then null; end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='sale_items_sale_id_fkey') then
    alter table public.sale_items add constraint sale_items_sale_id_fkey
      foreign key (sale_id) references public.sales(id) on delete cascade;
  end if;
exception when duplicate_object then null; end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='sale_items_product_id_fkey') then
    alter table public.sale_items add constraint sale_items_product_id_fkey
      foreign key (product_id) references public.products(id) on delete set null;
  end if;
exception when duplicate_object then null; end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='stocks_product_id_fkey') then
    alter table public.stocks add constraint stocks_product_id_fkey
      foreign key (product_id) references public.products(id) on delete cascade;
  end if;
exception when duplicate_object then null; end $$;

-- -------------------------
-- Preserve old inventory by creating matching products.
-- -------------------------
insert into public.products(name, price, cost, active)
select s.name, 0, 0, true
from public.stocks s
where s.name is not null and trim(s.name)<>''
and not exists (
  select 1 from public.products p
  where lower(trim(p.name))=lower(trim(s.name))
);

update public.stocks s
set product_id=p.id
from public.products p
where s.product_id is null
and s.name is not null
and lower(trim(s.name))=lower(trim(p.name));

-- -------------------------
-- Default categories
-- -------------------------
insert into public.categories(name)
select 'Food' where not exists (select 1 from public.categories where lower(name)='food');
insert into public.categories(name)
select 'Drinks' where not exists (select 1 from public.categories where lower(name)='drinks');
insert into public.categories(name)
select 'Add-ons' where not exists (select 1 from public.categories where lower(name)='add-ons');
insert into public.categories(name)
select 'Other' where not exists (select 1 from public.categories where lower(name)='other');

-- -------------------------
-- Existing records: fill safe defaults
-- -------------------------
update public.sales set sale_date=current_date where sale_date is null;
update public.sales set subtotal=0 where subtotal is null;
update public.sales set discount=0 where discount is null;
update public.sales set total=0 where total is null;
update public.sales set payment_method='Cash' where payment_method is null;
update public.sales set status='completed' where status is null;
update public.stocks set quantity=0 where quantity is null;
update public.stocks set low_limit=3 where low_limit is null;
update public.expenses set expense_date=current_date where expense_date is null;
update public.expenses set amount=0 where amount is null;

-- -------------------------
-- Indexes
-- -------------------------
create index if not exists sales_sale_date_idx on public.sales(sale_date);
create index if not exists sales_customer_idx on public.sales(customer_id);
create index if not exists sales_created_at_idx on public.sales(created_at);
create index if not exists sale_items_sale_idx on public.sale_items(sale_id);
create index if not exists sale_items_product_idx on public.sale_items(product_id);
create index if not exists expenses_date_idx on public.expenses(expense_date);
create index if not exists stocks_product_idx on public.stocks(product_id);
create index if not exists products_category_idx on public.products(category_id);

-- -------------------------
-- Registration trigger
-- First registered profile = ADMIN.
-- Later registered profiles = STAFF.
-- -------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  new_role text;
begin
  if not exists (select 1 from public.profiles limit 1) then
    new_role := 'admin';
  else
    new_role := 'staff';
  end if;

  insert into public.profiles(id,email,full_name,role)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),new_role)
  on conflict(id) do update set
    email=excluded.email,
    full_name=coalesce(nullif(excluded.full_name,''),public.profiles.full_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- -------------------------
-- RLS
-- -------------------------
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.stocks enable row level security;
alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.expenses enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists categories_all_authenticated on public.categories;
drop policy if exists products_all_authenticated on public.products;
drop policy if exists stocks_all_authenticated on public.stocks;
drop policy if exists customers_all_authenticated on public.customers;
drop policy if exists sales_all_authenticated on public.sales;
drop policy if exists sale_items_all_authenticated on public.sale_items;
drop policy if exists expenses_all_authenticated on public.expenses;

create policy profiles_select_authenticated on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy categories_all_authenticated on public.categories for all to authenticated using (true) with check (true);
create policy products_all_authenticated on public.products for all to authenticated using (true) with check (true);
create policy stocks_all_authenticated on public.stocks for all to authenticated using (true) with check (true);
create policy customers_all_authenticated on public.customers for all to authenticated using (true) with check (true);
create policy sales_all_authenticated on public.sales for all to authenticated using (true) with check (true);
create policy sale_items_all_authenticated on public.sale_items for all to authenticated using (true) with check (true);
create policy expenses_all_authenticated on public.expenses for all to authenticated using (true) with check (true);

select 'Cash Register X Automatic migration completed successfully.' as result;
