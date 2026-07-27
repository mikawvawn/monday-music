# Multi-user onboarding — design notes

**Goal:** turn Monday Music from a single-user site into something you deploy once and
share. A new user lands on an onboarding screen, connects their Spotify, enters their
email, and from then on gets a personalized digest emailed to them every Monday —
automatically, with no action on their part.

Status: **not built yet.** This is the design/roadmap doc. Captured 2026-07-27.

---

## What the user does (happy path)

1. Visits the app (e.g. `monday-music-mv.fly.dev`).
2. Enters their **email**.
3. Clicks **Connect Spotify** → Spotify consent screen → back to us.
4. Sees "You're in — first digest arrives Monday." Done.

Every Monday the backend loops over all signed-up users, generates each person's digest
from *their* Spotify taste, and emails it.

---

## The two things that sound simple but aren't

### 1. "Enter your Spotify API key" isn't how Spotify works

There is no per-user API key to paste. Spotify uses **OAuth 2.0**. To read someone's
top artists/tracks we need *them* to authorize our app, which yields a **refresh token**
we store and reuse weekly. So onboarding is a "Connect Spotify" button, not a text field.

- Flow: **Authorization Code** (we have a secure backend, so no PKCE needed — though PKCE
  is fine too). Redirect user to `/authorize` with scopes `user-top-read`,
  `user-read-recently-played`; handle the `/callback`; exchange `code` → `refresh_token`.
- Redirect URI must be HTTPS (Fly gives us that) and registered in the Spotify dashboard.
- Scopes stay minimal — exactly what `spotify.ts` already reads today.
- **We** (the app owner) still own ONE Spotify developer app; every user authorizes *that*
  app. Users never see client ID/secret.

**Gotcha — Spotify quota mode.** A new Spotify app is in *development mode*: capped at
**25 users**, each manually added to an allowlist in the dashboard. Going past that needs
**extended quota mode** (a Spotify review/approval). Fine for friends; a gate before "share
with the world." Document this expectation up front.

### 2. Emailing arbitrary people needs a verified domain

Today the (now-removed) email path used Resend's `onboarding@resend.dev` sender, which
**only delivers to the Resend account owner**. To email *other* users we must:

- Verify a sending domain in Resend (DNS records), send from e.g. `monday@yourdomain.com`.
- Add an **unsubscribe** link (both good manners and CAN-SPAM/deliverability). One-click
  unsubscribe → mark user inactive.

---

## Architecture

Current app is static nginx. Multi-user needs a small **backend + datastore + auth
callback**. Minimal shape:

```
[ Onboarding page ]  --email-->  [ web app (Node) ]  --OAuth--> Spotify
        |                              |
        |                        [ users store ]  { email, spotify_refresh_token, active, created_at }
        |                              |
[ weekly cron ] --for each user--> generate digest (existing pipeline) --> Resend email
```

**Components**

- **Web app** — replaces the pure-nginx image with a tiny Node server (Fastify/Express) that
  serves the onboarding page, handles `/authorize` + `/callback`, and writes users. Still one
  Fly app; drop `min_machines_running = 0` to 1 if we want the OAuth callback always warm
  (or keep scale-to-zero and accept a cold start on callback).
- **Datastore** — options, cheapest first:
  - **SQLite on a Fly volume** — simplest, but a volume pins the app to one machine/region and
    complicates scale-to-zero.
  - **Turso / Neon / Supabase (managed)** — free tiers, plays nice with scale-to-zero and CI.
    Recommended for a shareable product.
- **Weekly job** — keep the GitHub Action cron, but change it from "generate one site" to
  "loop all active users → generate → email each." Or move to a **Fly scheduled machine**.
  Per-user failures must be isolated (one bad token shouldn't kill everyone's digest).
- **Email** — resurrect an email renderer. `git show <pre-pivot>:src/email.ts` has the old
  `buildEmailHtml`/`sendEmail`; the current `render.ts` markup also works as an email body.
  Alternative: host a per-user page and email a link (more shareable, less inbox clutter).

**What already works multi-user:** the generation core is user-agnostic. `buildTasteProfile()`
takes any user's artists, and `curateNewReleases()` / `enrichAndFilterReleases()` take a token
+ profile. So per-user generation is mostly: get a token from the stored refresh token, run the
existing pipeline, render, send.

---

## Security & privacy (don't skip)

- **Spotify refresh tokens are credentials.** Encrypt at rest; never log; never commit. If using
  a managed DB, use its encryption + scoped keys.
- **Email is PII.** Store the minimum; provide unsubscribe + delete.
- Rotate/revoke: handle Spotify token revocation gracefully (user revokes access → mark inactive,
  optionally email them to reconnect).

---

## Suggested phasing

1. **Backend skeleton** — swap nginx image for a Node server that still serves today's static
   page, deployed to the same Fly app. No behavior change; just room to grow.
2. **Spotify OAuth** — `/authorize` + `/callback`, store `{email, refresh_token}` in a managed DB.
   Onboarding page = email field + Connect Spotify button.
3. **Per-user weekly email** — verify a Resend domain, resurrect the email renderer, change the
   cron to loop active users with per-user error isolation + unsubscribe.
4. **Polish** — "reconnect Spotify" on token failure, request Spotify extended quota mode, basic
   admin view of signups.

## Open questions

- **Email digest vs. per-user hosted page vs. both?** User asked for email; a shareable link is
  arguably nicer and sidesteps domain-verification/deliverability. Could do both.
- **Managed DB choice** (Turso vs Neon vs Supabase) — pick when Phase 2 starts.
- **Who pays for Anthropic/Spotify usage at scale?** Fine for friends; needs thought before wide
  sharing (rate limits, cost per user per week).
