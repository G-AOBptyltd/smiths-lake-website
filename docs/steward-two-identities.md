# A steward has two separate logins

**Logged 12 Sep 2026. Not acted on — Greg's call was "log it, don't act yet".**

## The problem

The same person needs two unrelated accounts to do one job.

| Surface | URL | Sign-in | Identity store |
|---|---|---|---|
| Volunteer app | `smithslake-stewards.village1st.com.au` | emailed magic link, no password | Supabase `auth.users` |
| Admin console | `villagefirst.org.au/admin/…` | email + password | Netlify Identity (GoTrue) |

Nothing links them. A steward appointed in the console gets a Netlify Identity
invite; the volunteer record the app recognises them by lives in Supabase and
is matched separately, by email string.

## Why it bites

* **It caused the original complaint.** Stewards kept "landing on the website
  instead of the app", because the only links onboarding ever sent them — the
  Identity invite and the welcome email — pointed at the console. Fixed on
  12 Sep by pointing the welcome email at the app, but the split remains.
* **The two can disagree.** Appointing a steward writes a Notion register row,
  a Netlify Identity role, *and* (since 12 Sep) a Supabase `volunteer_roles`
  row. Three stores, joined by email. Change an email in one place and a
  steward silently loses access somewhere else.
* **It doubles the reasons to give up.** A volunteer who happily taps a magic
  link will not necessarily set up, remember and use a password for a second
  site to see their group's hours ledger.
* **Matching is by email string.** `findAppVolunteer()` falls back to an
  unambiguous name match when there is no email. That is deliberate and
  guarded, but it is a join on human-entered text.

## Options, roughly in order of effort

1. **Magic-link sign-in for the console.** Netlify Identity supports an
   emailed login link. Closest to "one way to sign in" without changing
   either identity store. Does not merge the accounts — a steward still has
   two — but removes the password and makes both surfaces feel the same.
2. **Auto-provision on appointment.** When a steward is appointed, create the
   Supabase volunteer record too if their email has none, rather than warning
   "they need to open the app and sign up once, then re-save them here".
   Removes the most common failure without touching auth.
3. **One identity store.** Move the console onto Supabase auth, or the app
   onto Netlify Identity. Correct, and much the largest job: every `/admin/`
   page and ~75 functions assume Netlify Identity's `clientContext`.
4. **Link the two explicitly.** Store the Netlify Identity `sub` on the
   Supabase volunteer row when both are known, so the join stops depending on
   email. Cheap, and makes a future merge far safer.

## What is already true and worth keeping

* Supabase is the source of truth for volunteers (7 Sep 2026).
* Appointing a steward now writes the Supabase `group_leader` role, so the
  app's steward view follows the console's register (12 Sep 2026).
* Stewards can now see their own hours in *both* places, so neither surface
  is a dead end while this is unresolved.

## Related

* `netlify/functions/_vapp.js` — email-matched bridge between the two stores
* `netlify/functions/steward-admin.js` — writes Notion + Identity + Supabase
* `docs/` sibling notes on the volunteer hub
