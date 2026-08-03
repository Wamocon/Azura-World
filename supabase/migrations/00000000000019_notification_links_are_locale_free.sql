-- 00000000000019_notification_links_are_locale_free.sql
--
-- A notification must not carry a language in its link.
--
-- ## What was wrong
--
-- Every one of the 37 rows in public.notifications with a link stored it with a
-- locale segment already baked in — 36 as `/de/dashboard/...` and one as
-- `/tr/dashboard/communications`. The existing constraint
-- `notifications_link_is_relative` only checks that the path is site-relative
-- and not protocol-relative, so `/de/dashboard/tickets` passes it cleanly.
--
-- lib/dashboard-routing.ts names this exact failure in its own comment, about
-- its own href column:
--
--     Locale-less path, always starting `/dashboard`. The locale prefix is
--     added at render time by W1-C's `Link` — storing `/de/dashboard/units`
--     here would bake one locale into the config and break the other three.
--
-- The rule was written down and the notifications table did the opposite.
--
-- ## Two separate bugs, both invisible until something rendered the link
--
-- 1. A Turkish, Russian or English reader following a notification landed on
--    the GERMAN page. Not a 404 — a working page in a language they did not
--    ask for, which is the harder kind of wrong to notice and report.
--
-- 2. Passed through the locale-aware `Link`, which prepends the reader's
--    locale as designed, the result is `/en/de/dashboard/tickets`. That route
--    does not exist. Next prefetches it on hover and the request never
--    completes, so the page also never reaches network-idle — which is how
--    this was found: a browser test that had passed for weeks began timing out
--    on this one page the moment a component started rendering these links.
--
-- Nothing rendered `notifications.link` before now, so neither symptom had ever
-- been reachable. The data has been wrong since it was seeded.
--
-- ## The fix, and why the constraint matters more than the UPDATE
--
-- The UPDATE repairs today's rows. The CHECK is what stops the next seed script
-- or the next feature from reintroducing it — this is data whose wrongness is
-- undetectable by reading it, so it needs to be undetectable-by-writing-it
-- instead.

-- Strip a leading locale segment. `/de/dashboard/x` -> `/dashboard/x`, and a
-- bare `/de` -> `/dashboard` (the one seeded row of that shape pointed at the
-- dashboard home).
update public.notifications
   set link = case
                when link ~ '^/(tr|en|ru|de)$' then '/dashboard'
                else regexp_replace(link, '^/(tr|en|ru|de)/', '/')
              end
 where link ~ '^/(tr|en|ru|de)(/|$)';

-- A link is a route, not a rendered URL. The locale belongs to the reader and
-- is applied at render time; storing one here decides for them.
--
-- NOT VALID is deliberately NOT used: the UPDATE above has already repaired
-- every existing row, so the constraint can be validated immediately and a
-- surviving bad row should fail this migration loudly rather than be
-- grandfathered in.
alter table public.notifications
  drop constraint if exists notifications_link_has_no_locale;

alter table public.notifications
  add constraint notifications_link_has_no_locale
  check (link is null or link !~ '^/(tr|en|ru|de)(/|$)');

comment on column public.notifications.link is
  'Site-relative, LOCALE-FREE route, e.g. "/dashboard/tickets". The reader''s locale is prepended at render time by the app''s Link component; a locale stored here would send every reader to one language and, once prefixed again, to a route that does not exist. Enforced by notifications_link_has_no_locale.';
