-- Cash Register X V9.1: allow Staff to manage Expenses
-- Run once in Supabase SQL Editor. Safe for existing expense data.

-- Staff/Admin can read expenses.
drop policy if exists expenses_read_authenticated on public.expenses;
create policy expenses_read_authenticated on public.expenses
for select to authenticated using (true);

-- Staff/Admin can add expenses.
drop policy if exists expenses_insert_admin on public.expenses;
drop policy if exists expenses_insert_staff_admin on public.expenses;
create policy expenses_insert_staff_admin on public.expenses
for insert to authenticated
with check (public.current_user_role() in ('admin','staff'));

-- Staff/Admin can edit expenses.
drop policy if exists expenses_update_admin on public.expenses;
drop policy if exists expenses_update_staff_admin on public.expenses;
create policy expenses_update_staff_admin on public.expenses
for update to authenticated
using (public.current_user_role() in ('admin','staff'))
with check (public.current_user_role() in ('admin','staff'));

-- Staff/Admin can delete expenses.
drop policy if exists expenses_delete_admin on public.expenses;
drop policy if exists expenses_delete_staff_admin on public.expenses;
create policy expenses_delete_staff_admin on public.expenses
for delete to authenticated
using (public.current_user_role() in ('admin','staff'));

select 'Staff expense permissions enabled.' as result;
