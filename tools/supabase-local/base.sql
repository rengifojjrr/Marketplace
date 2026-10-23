-- Ejecutado por tools/supabase-local/levantar.sh sobre cada base de pruebas.
-- Idempotente: se puede correr sobre una base nueva o ya preparada.
--
-- Réplica mínima de lo que un proyecto Supabase trae por base: roles de la
-- API (son del clúster; se crean si faltan), esquema `extensions` con
-- pgcrypto, privilegios por omisión del esquema public y un esquema `storage`
-- con las columnas de storage.buckets y storage.objects que usa Tumbo (la
-- pasarela local hace de servicio de Storage). Solo para pruebas locales.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'local';
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
-- Tiempos límite por rol, como en Supabase.
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text,
  owner            uuid,
  metadata         jsonb,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  unique (bucket_id, name)
);
-- Como en Supabase: RLS activo y la API sin acceso directo a las tablas.
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
revoke all on schema storage from public, anon, authenticated;
revoke all on storage.buckets, storage.objects from public, anon, authenticated;
grant usage on schema storage to service_role;
grant all on storage.buckets, storage.objects to service_role;
