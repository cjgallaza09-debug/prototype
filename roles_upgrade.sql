-- Cash Register X Automatic: Admin / Staff role security upgrade
-- Safe for the existing database. Does not delete business data.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path=public
as $$
  select coalesce((select role from public.profiles where id=auth.uid()), 'staff');
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- Keep role values limited to the two application roles.
update public.profiles set role='staff' where role is null or role not in ('admin','staff');

-- Profiles: users can read profiles, but cannot change their own role from the client.
drop policy if exists profiles_update_own on public.profiles;

-- Categories: Staff + Admin can manage categories used by Products/POS.
drop policy if exists categories_all_authenticated on public.categories;
create policy categories_staff_admin on public.categories
for all to authenticated
using (public.current_user_role() in ('admin','staff'))
with check (public.current_user_role() in ('admin','staff'));

-- Products: Staff + Admin can manage products.
drop policy if exists products_all_authenticated on public.products;
create policy products_staff_admin on public.products
for all to authenticated
using (public.current_user_role() in ('admin','staff'))
with check (public.current_user_role() in ('admin','staff'));

-- Inventory: Staff + Admin can manage inventory.
drop policy if exists stocks_all_authenticated on public.stocks;
create policy stocks_staff_admin on public.stocks
for all to authenticated
using (public.current_user_role() in ('admin','staff'))
with check (public.current_user_role() in ('admin','staff'));

-- Sales: Staff needs read access for Dashboard and insert access for POS.
-- Only Admin can edit/delete/refund existing sales.
drop policy if exists sales_all_authenticated on public.sales;
create policy sales_read_authenticated on public.sales
for select to authenticated using (true);
create policy sales_insert_staff_admin on public.sales
for insert to authenticated
with check (public.current_user_role() in ('admin','staff'));
create policy sales_update_admin on public.sales
for update to authenticated
using (public.current_user_role()='admin')
with check (public.current_user_role()='admin');
create policy sales_delete_admin on public.sales
for delete to authenticated
using (public.current_user_role()='admin');

-- Sale items: Staff needs to insert POS line items; Admin can manage them.
drop policy if exists sale_items_all_authenticated on public.sale_items;
create policy sale_items_read_authenticated on public.sale_items
for select to authenticated using (true);
create policy sale_items_insert_staff_admin on public.sale_items
for insert to authenticated
with check (public.current_user_role() in ('admin','staff'));
create policy sale_items_update_admin on public.sale_items
for update to authenticated
using (public.current_user_role()='admin')
with check (public.current_user_role()='admin');
create policy sale_items_delete_admin on public.sale_items
for delete to authenticated
using (public.current_user_role()='admin');

-- Expenses: Staff and Admin can read/create/edit/delete expense records.
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
for insert to authenticated
with check (public.current_user_role() in ('admin','staff'));
create policy expenses_update_staff_admin on public.expenses
for update to authenticated
using (public.current_user_role() in ('admin','staff'))
with check (public.current_user_role() in ('admin','staff'));
create policy expenses_delete_staff_admin on public.expenses
for delete to authenticated
using (public.current_user_role() in ('admin','staff'));

-- Customers: Staff can use the customer selector in POS; only Admin can manage the page.
drop policy if exists customers_all_authenticated on public.customers;
create policy customers_read_authenticated on public.customers
for select to authenticated using (true);
create policy customers_insert_staff_admin on public.customers
for insert to authenticated
with check (public.current_user_role() in ('admin','staff'));
create policy customers_update_staff_admin on public.customers
for update to authenticated
using (public.current_user_role() in ('admin','staff'))
with check (public.current_user_role() in ('admin','staff'));
create policy customers_delete_admin on public.customers
for delete to authenticated
using (public.current_user_role()='admin');

select 'Admin / Staff role security upgrade completed.' as result;
