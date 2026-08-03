-- 00000000000020_notification_event_templates.sql
--
-- Let a system notification be read in the reader's language.
--
-- ## What was wrong
--
-- `public.notifications` stores rendered prose — `title` and `body` — plus a
-- `locale` column recording which language that prose is in. Every one of the 37
-- seeded rows is German, for every recipient, in every role. So a Turkish
-- manager opened a fully Turkish interface and found six German notifications
-- inside it, and a Russian owner the same. The `locale` column meant the product
-- KNEW the text was German and displayed it anyway, because there was nothing
-- else to display.
--
-- This is a different problem from a message body being in German. A message is
-- what a person actually wrote, and translating it would be a lie about what
-- they said. A notification of this kind is machine-generated from a system
-- event — "an SLA was breached", "a document was approved" — and there is a
-- correct rendering of that event in each of the four languages.
--
-- ## What this migration does, and what it is careful not to do
--
-- The 37 rows collapse into exactly EIGHT distinct (title, body, category,
-- severity) tuples. They are the eight events the seed generator emits. This
-- migration classifies each row by writing `payload.template` — a stable key for
-- the event — and changes nothing else.
--
--   * `title` and `body` are NOT modified. The original German text stays on the
--     row, and the application falls back to it whenever a row carries no
--     recognised template. So a notification written by some future code path
--     that this migration has never seen still renders — in whatever language it
--     was written, which is the honest outcome — rather than disappearing.
--   * `locale` is NOT modified. It still truthfully records the language of the
--     stored prose.
--   * No new text is invented here. The mapping is a lossless classification of
--     literals the seed generator itself produced; the translations live in
--     apps/web/messages/*.json where every other string in this product lives,
--     and are subject to the same `pnpm qa:i18n` gate.
--
-- The alternative — rewriting `title` and `body` into the recipient's language
-- in the database — was rejected. It would destroy the original record, it
-- would have to be redone every time a locale is added, and it would put
-- user-facing copy in a migration where the i18n gate cannot see it.

update public.notifications
   set payload = payload || jsonb_build_object('template', t.template)
  from (values
    ('Prüfung überfällig',      'compliance.checkOverdue'),
    ('Frist überschritten',     'service.slaBreached'),
    ('Dokument freigegeben',    'document.approved'),
    ('Neue Meldung zugewiesen', 'service.ticketAssigned'),
    ('Neue Nachricht',          'message.residentReplied'),
    ('Offener Posten fällig',   'finance.itemOverdue'),
    ('Neue Anfrage',            'lead.received'),
    ('Guthaben niedrig',        'finance.walletLow')
  ) as t(title, template)
 where public.notifications.title = t.title
   and not (public.notifications.payload ? 'template');

comment on column public.notifications.payload is
  'Event context. A `template` key, when present, names the system event this notification reports (e.g. "service.slaBreached") and the app renders the event in the READER''S language from apps/web/messages/*.json, ignoring the stored title/body. A row without one renders its stored title/body verbatim — which is correct for anything a person actually wrote. See migration 20.';
