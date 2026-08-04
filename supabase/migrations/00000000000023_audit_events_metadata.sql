-- 00000000000023_audit_events_metadata.sql
--
-- Give `audit_events` the column the API layer has been writing to since it was
-- built, and which has never existed.
--
-- ## The audit trail has recorded nothing. Ever.
--
-- `lib/api-handler.ts` → `writeAudit()` inserts:
--
--     actor_profile_id, company_id, action, entity_table, metadata
--
-- and `public.audit_events` has no `metadata` column — its columns are id,
-- company_id, actor_profile_id, action, entity_table, entity_id, before_data,
-- after_data, ip_address, user_agent, request_id, created_at. So every insert
-- from the API layer failed on an undefined column.
--
-- It failed silently, twice over. PostgREST returns `{ error }` rather than
-- throwing, so the surrounding `try/catch` never fired and even the
-- `console.warn` in its handler never ran; and the returned error was not
-- inspected. Measured before this migration:
--
--     select count(*) from public.audit_events   ->   0
--
-- Zero rows, for the life of the project, across every mutation the product has
-- ever performed. `scripts/validate-openapi.mjs` fails the build if a mutating
-- route does not DECLARE an audit action — so the declaration was enforced all
-- the way through while the write was discarded.
--
-- ## Why a new column rather than reusing `after_data`
--
-- `before_data` and `after_data` mean the row's state either side of the change,
-- and `lib/governance-audit.ts` uses them that way. What the API layer records is
-- different in kind: the request context — method, path, outcome, error code,
-- and the role the caller held. Putting that in `after_data` would make the
-- column mean two things depending on which writer produced the row, and anyone
-- later reading the trail would have to know which to expect.
--
-- `jsonb not null default '{}'` so every existing row stays valid and the column
-- is never null to test for.
alter table public.audit_events
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.audit_events.metadata is
  'Request context from the API layer: method, path, outcome, errorCode, role. Distinct from before_data/after_data, which hold the ROW''s state either side of a change — see lib/governance-audit.ts. Never a request body, a query string or a header: an audit row records what was attempted and by whom, and the payload would recreate the PII surface the API layer otherwise avoids.';

-- The trail is queried by "what happened to this record" and "what did this
-- person do", and had an index for neither.
create index if not exists idx_audit_events_entity
  on public.audit_events (entity_table, entity_id, created_at desc);

create index if not exists idx_audit_events_actor
  on public.audit_events (actor_profile_id, created_at desc);
