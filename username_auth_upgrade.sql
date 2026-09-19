-- Cash Register X V9.1 Username + Password authentication
-- Run once in Supabase SQL Editor. Does not delete business data.

alter table public.profiles add column if not exists username text;

-- Give existing profiles a username from the part before @, where possible.
update public.profiles
set username = lower(split_part(email, '@', 1))
where (username is null or trim(username)='')
  and email is not null
  and split_part(email, '@', 1) <> '';

create unique index if not exists profiles_username_lower_idx
on public.profiles (lower(username));

-- Resolve a login username to the underlying Supabase Auth email.
-- This is needed because Supabase Auth itself still uses email/password underneath;
-- the email is never shown in the app login or Staff registration form.
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

-- Keep profile role values limited to Admin/Staff.
update public.profiles set role='staff' where role is null or role not in ('admin','staff');

select 'Username authentication upgrade completed.' as result;
