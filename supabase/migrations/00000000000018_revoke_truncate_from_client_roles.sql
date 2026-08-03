-- 00000000000018_revoke_truncate_from_client_roles.sql
--
-- Take TRUNCATE away from the two roles a browser can hold.
--
-- ## What was wrong
--
-- Supabase ships `grant all on all tables in schema public to anon, authenticated`
-- as a project default. `all` is seven privileges, and this project's migrations
-- only ever took four of them back. Migration 00 states the principle exactly
-- right at line 166 — "the revoke must name each role", `revoke … from public`
-- will not undo a role grant — and then writes:
--
--   revoke insert, update, delete on public.profiles from authenticated;
--
-- TRUNCATE, TRIGGER and REFERENCES are not in that list, and were never revoked
-- anywhere. Measured on the live database before this migration:
--
--   anon           SELECT, TRUNCATE, TRIGGER, REFERENCES   on 16 tables
--   authenticated  SELECT, INSERT, UPDATE, TRUNCATE, …     on 44 tables
--
-- ## Why TRUNCATE specifically is not a cosmetic leftover
--
-- Row-level security does not apply to TRUNCATE. Every other write privilege on
-- these tables is narrowed by a policy — that is the whole design, and the audit
-- confirms all 40 tables have RLS enabled with policies attached. TRUNCATE is
-- the one write that walks past all of it. A single statement would empty
-- `sourced_facts`, and with it every piece of evidence this product exists to
-- prove.
--
-- It was not reachable in practice: PostgREST exposes SELECT/INSERT/PATCH/DELETE
-- and RPC, and has no TRUNCATE verb, so no browser request could reach it today.
-- That is a property of the API layer, not of the permission — it holds only
-- until the first SECURITY INVOKER function or SQL path runs as `authenticated`.
-- A privilege whose only protection is "nothing currently calls it" is one
-- refactor from being a privilege that is called.
--
-- TRIGGER and REFERENCES go with it. A client role has no business attaching a
-- trigger to a table or pointing a foreign key at one; both are schema authority,
-- and both are granted here by the same accident.
--
-- ## Scope
--
-- Nothing a working page does is affected. No read, no insert, no update in this
-- codebase uses any of the three. The default-privileges line covers tables a
-- later migration creates, so this does not have to be remembered again.

revoke truncate, trigger, references on all tables in schema public
  from anon, authenticated;

alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
