# Freemium & Usage Metering — Addendum to PRD v2.0.0

**Added:** Server v2.1 / August 31, 2026
**Status:** Implemented in `server.js` and `public/index.html`

## What changed from v2.0

v2.0 required a verified account before any tool could be used at all (the
"Auth Gate" blocked every click). v2.1 removes that wall and replaces it with
a metered freemium model, matching the brief: try before you sign up, more
uses once you do.

## Tiers

| Tier | Identified by | Limit | Reset |
|---|---|---|---|
| Guest (no account) | Client IP address | 1 use / tool / day | Rolling UTC day |
| Free account (signed up + OTP verified) | Account email | 3 uses / tool / day | Rolling UTC day |
| Premium (reserved, not yet sold) | `user.premium === true` | Unlimited | — |

Every one of the 20 tools is metered independently — using your 1 free
`Merge PDF` today doesn't touch your `Compress PDF` allowance.

The `premium` flag already exists on the user record and is checked by the
limiter, but there is no UI, pricing, or payment flow to set it yet — that's
Phase 3 (Stripe) per the PRD roadmap. Flip a user's flag manually today and
they're unlimited; that's the intended extension point for the paid tier.

## How enforcement works

- **Anonymous tools** (14 of 20 — pdf-lib/jsPDF/PDF.js in the browser): the
  frontend calls `POST /api/usage/consume` *before* running the local
  processing function. A 429 aborts processing and shows the upgrade modal;
  the file never left the browser either way.
- **Server tools** (6 of 20 — LibreOffice/Ghostscript): the conversion route
  itself calls the same metering function before touching LibreOffice/gs, so
  there's exactly one place enforcement can be bypassed from, and it can't be
  skipped by calling the API directly instead of through the UI.
- Identity resolution: a valid Bearer token → billed against the account: no
  token, or an expired/invalid one → billed against `req.ip` (respecting
  `TRUST_PROXY` for the reverse-proxy hop).
- Usage counters live in `usage.json` next to `users.json` (same OS-temp-dir,
  no-DB pattern as v2.0). A cron pass every 30 minutes drops rows older than
  yesterday — nothing to grow unbounded.

## New endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/usage/status?toolId=` | Optional Bearer | Read current quota without spending it. |
| POST | `/api/usage/consume` | Optional Bearer | Spend one unit; 429 with a `usage` payload when exhausted. |

Both accept the same identity resolution as above. Existing conversion
routes (`/api/convert/*`, `/api/repair`) now also require a `toolId` form
field and enforce the same check inline.

## Frontend changes

- The old `AuthGate` (hard block) is gone. Tool workspaces open directly for
  anyone.
- A `UsageBadge` shows remaining uses at the top of every workspace ("1 of 1
  free use left today", "Sign up free for more →").
- An anonymous-only `GuestBanner` nudges sign-up without blocking.
- Hitting a 429 opens `UpgradeModal`: guests are offered sign-up/login;
  signed-in free users are told their quota resets at midnight UTC.

## Operational notes / NFRs added alongside this

- `express-rate-limit` now guards all `/api/*` routes (300 req/15min/IP) with
  a stricter limit on `/api/auth/*` (20 req/15min/IP) for brute-force
  protection — configurable via `RATE_LIMIT_API_MAX` / `RATE_LIMIT_AUTH_MAX`.
- `app.set('trust proxy', ...)` added (env `TRUST_PROXY`, default 1) — required
  for `req.ip` to reflect the real client behind Nginx/Caddy; without it every
  guest would appear to share the proxy's IP and share one global quota.
- `multer` upgraded from the 1.x line (known CVEs, deprecated upstream) to
  2.x — same API surface, no route changes needed.
- Limits are environment-configurable (`FREE_ANON_DAILY_LIMIT`,
  `FREE_USER_DAILY_LIMIT`) so they can be tuned post-launch without a
  redeploy of application logic.
- Added visible-focus / `prefers-reduced-motion` CSS and `aria-label`s on
  icon-only buttons (close, zoom, theme toggle, etc.) — WCAG AA gaps from
  v2.0's accessibility section.

## Known limitations (carried from v2.0, still true)

- Usage/user/token stores are in-memory + single JSON file — fine to ~10K
  users per the original PRD, but a multi-instance deployment needs these
  migrated to Redis/Postgres (already flagged as Phase 2 in the PRD).
- IP-based guest identification is shared across NAT/office networks and is
  bypassable via a VPN or incognito+different exit IP — acceptable for an
  abuse *deterrent*, not a hard guarantee. Documented as a known trade-off
  when the "server-side by IP" tracking approach was chosen over
  cookie/fingerprint tracking.
