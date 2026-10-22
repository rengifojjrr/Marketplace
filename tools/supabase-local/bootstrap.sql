-- Ejecutado por tools/supabase-local/iniciar.sh al crear el clúster.
-- Réplica mínima de los roles y esquemas de un proyecto Supabase (solo pruebas locales)
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'local';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login createrole noinherit password 'local';
create schema auth authorization supabase_auth_admin;
grant create on database postgres to supabase_auth_admin;
create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role, postgres;
alter role supabase_auth_admin set search_path = auth;
create publication supabase_realtime;
