-- 003_platform_domains.sql
--
-- Platform-owned root domains that storefront subdomains hang off.
--
-- Why this exists: formatDomain() hardcoded "keel.framestudio.co.ke", so owning a
-- second root (myshop.co.ke) meant editing that function plus six templates. The
-- DNS side already generalises — *.keel.framestudio.co.ke is CNAMEd to
-- cname.vercel-dns.com and serves fine; buying another root needs exactly one more
-- CNAME record. Only the code was hardcoded.
--
-- One row per root domain FrameStudio owns. A shop gets <label>.<domain>.

create table if not exists platform_domains (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  domain text not null unique,
  wildcard_host text not null default 'cname.vercel-dns.com',
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.platform_domains is
  'Root domains FrameStudio owns. One wildcard CNAME per row covers unlimited storefront subdomains.';

alter table public.platform_domains enable row level security;

-- Shop owners read the roots to preview the address they are claiming. Only
-- service_role writes. No anon access on purpose: storefronts read their own
-- settings with the anon key and must not be able to enumerate our domains.
drop policy if exists "platform_domains are readable by signed-in users" on public.platform_domains;

create policy "platform_domains are readable by signed-in users"
  on public.platform_domains
  for select
  to authenticated
  using (active);

revoke all on public.platform_domains from anon;

-- Supabase's schema default privileges hand `authenticated` full table rights on
-- every new table in public, so the GRANT below is not the whole story: verified
-- with aclexplode, authenticated ends up with INSERT/UPDATE/DELETE/TRUNCATE.
-- RLS only has a SELECT policy so those rights are inert today, but a shop owner
-- who could write here could nominate themselves as the default root or point
-- wildcard_host somewhere hostile. Revoke explicitly and re-grant SELECT only.
revoke all on public.platform_domains from authenticated;
grant select on public.platform_domains to authenticated;
grant all on public.platform_domains to service_role;

-- At most one active default. The index only contains rows where is_default is
-- true, so a plain unique index over that column means "exactly one row".
create unique index if not exists platform_domains_single_default
  on public.platform_domains (is_default)
  where is_default;

insert into public.platform_domains (key, domain, wildcard_host, is_default, active)
values ('keel', 'keel.framestudio.co.ke', 'cname.vercel-dns.com', true, true)
on conflict (key) do update
  set domain    = excluded.domain,
      wildcard_host = excluded.wildcard_host,
      is_default = excluded.is_default,
      active     = excluded.active;

-- The root a new storefront should use. Deliberately never returns null: the
-- literal is a floor so an empty or missing table can never block a deploy.
create or replace function public.default_platform_domain()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (
      select d.domain
      from public.platform_domains d
      where d.active and d.is_default
      order by d.created_at
      limit 1
    ),
    'keel.framestudio.co.ke'
  );
$$;

revoke all on function public.default_platform_domain() from public;
-- Supabase's default privileges auto-grant EXECUTE on every new function to anon
-- and authenticated, and `revoke ... from public` does NOT clear those explicit
-- entries. Naming anon here is what actually removes it — otherwise this leaks
-- the default root to the public role, which is exactly what the table's RLS
-- policy above is there to prevent.
revoke all on function public.default_platform_domain() from anon, authenticated;
grant execute on function public.default_platform_domain() to postgres, authenticated, service_role;

-- ---------------------------------------------------------------- multi-root
-- Uniqueness has to move from the label to the fully-qualified name. With two
-- root domains "shop" is a legitimate label on both, but
-- storefront_deployments_subdomain_key (UNIQUE (subdomain)) would refuse the
-- second one. The non-unique label index stays for lookups.
alter table public.storefront_deployments
  drop constraint if exists storefront_deployments_subdomain_key;

create unique index if not exists storefront_deployments_domain_uniq
  on public.storefront_deployments (domain)
  where domain is not null;

-- is_subdomain_taken now checks the FQDN, so the same label on a different root
-- is free. DROP both signatures first: CREATE OR REPLACE with a new parameter
-- silently creates an OVERLOAD and leaves the old one behind, which makes calls
-- ambiguous. Both drops are needed for the migration to be re-runnable — dropping
-- only the one-arg form leaves the two-arg form this file creates.
drop function if exists public.is_subdomain_taken(text, text);
drop function if exists public.is_subdomain_taken(text);

create function public.is_subdomain_taken(p_subdomain text, p_root text default null)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.storefront_deployments d
    where d.domain = lower(btrim(p_subdomain)) || '.' ||
      case
        when p_root is null or btrim(p_root) = '' then public.default_platform_domain()
        else lower(btrim(p_root))
      end
  );
$$;

-- Must agree with storefront_deployments_domain_uniq, or the owner is told a
-- subdomain is free and the insert then fails on the unique index.
--
-- anon is revoked by name, not via `from public`: Supabase's default privileges
-- hand anon an EXECUTE grant on every new function, and it did not have one on
-- the previous signature. Verified with has_function_privilege after applying.
revoke all on function public.is_subdomain_taken(text, text) from public, anon, authenticated;
grant execute on function public.is_subdomain_taken(text, text)
  to postgres, authenticated, service_role;
