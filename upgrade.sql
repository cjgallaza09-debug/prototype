-- CASH REGISTER X AUTOMATIC - UPGRADE FOR EXISTING DATABASE
-- Run this ONCE in Supabase if your existing tables are already present.
-- It does not delete sales, inventory, expenses, or accounts.

alter table public.stocks add column if not exists unit text default 'pcs';
alter table public.stocks add column if not exists quantity numeric(12,3) default 0;
alter table public.stocks add column if not exists low_limit numeric(12,3) default 3;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='stocks' and column_name='quantity' and data_type='integer') then
    alter table public.stocks alter column quantity type numeric(12,3) using quantity::numeric;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='stocks' and column_name='low_limit' and data_type='integer') then
    alter table public.stocks alter column low_limit type numeric(12,3) using low_limit::numeric;
  end if;
end $$;

update public.stocks set unit='pcs' where unit is null or trim(unit)='';
update public.stocks set quantity=0 where quantity is null;
update public.stocks set low_limit=3 where low_limit is null;

alter table public.sale_items add column if not exists quantity numeric(12,3) default 1;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='sale_items' and column_name='quantity' and data_type='integer') then
    alter table public.sale_items alter column quantity type numeric(12,3) using quantity::numeric;
  end if;
end $$;

alter table public.expenses add column if not exists payment_method text default 'Cash';
alter table public.expenses add column if not exists reference_no text;
update public.expenses set payment_method='Cash' where payment_method is null or trim(payment_method)='';

notify pgrst, 'reload schema';

select 'Cash Register X upgrade completed.' as result;
