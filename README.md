# VTBL

VTBL is a lightweight ID verification service. A business requests a QR
code for a customer; the customer scans it, photographs the front and back
of their ID from their phone browser, and VTBL takes it from there:
stores the images, runs an automated "visual" check (OCR-based, not
banking-grade), and lets the business fetch the images and record a manual
verified/rejected decision through a simple HTTP API.

This document is the integration guide for businesses connecting to a
running VTBL instance, plus operator instructions for running and
deploying VTBL itself.

---

## How it works

1. **You request a verification.** `POST /api/verifications` with a
   `customerType` and `customerId`. VTBL returns a QR code and a capture
   link.
2. **You show the QR code to your customer** (on a kiosk, receipt, checkout
   screen, etc.), or send them the capture link directly.
3. **The customer scans it on their phone.** It opens a mobile web page
   (Chrome or any modern mobile browser) that asks for camera permission and
   walks them through photographing the front, then the back, of their ID.
   When done, they see a "Thank you" screen.
4. **VTBL uploads and processes the images.** As soon as both photos are
   in, the status becomes `ID_UPLOADED` and VTBL notifies you (webhook
   and/or polling - see below).
5. **VTBL runs an automated visual check** (OCR: text legibility, and
   sanity-checks for ID-number and date formatting) and updates the status to
   `VISUALLY_VERIFIED` or `VISUALLY_REJECTED`, notifying you again.
6. **You review and make the final call.** Fetch the front/back images and
   call the decision endpoint to mark the submission `verified` or
   `rejected` on your own authority. This is recorded permanently in
   VTBL's status history alongside your business name.

## Status states

Every verification request moves through these states. All state changes
are permanently recorded with a timestamp and are visible in
`statusHistory` on the verification record.

| Status | Meaning |
| --- | --- |
| `PENDING` | QR/link issued, waiting for the customer to submit photos. |
| `ID_UPLOADED` | Front and back photos received. |
| `VISUALLY_VERIFIED` | "ID Visually Verified by VTBL Software" - passed the automated OCR heuristic check. |
| `VISUALLY_REJECTED` | "ID Visually Rejected by VTBL Software" - failed the automated check (see `rejectionReason`). |
| `MANUALLY_VERIFIED` | "ID Manually Verified by `<Your Business Name>`" - you confirmed it via the decision endpoint. |
| `MANUALLY_REJECTED` | "ID Manually Rejected by `<Your Business Name>`" - you rejected it via the decision endpoint. |
| `EXPIRED` | The customer never completed the capture flow before the link's TTL ran out. |

`VISUALLY_VERIFIED`/`VISUALLY_REJECTED` are VTBL's automated opinion, not
final - you can still call the decision endpoint afterwards to set the
manual, business-attributed outcome that matters for your own records.

---

## Web interfaces

The home page at [`https://vtbl.com`](https://vtbl.com) is a marketing landing page. The tools live at:

| URL | Who it's for | What it does |
| --- | --- | --- |
| [`https://vtbl.com/portal`](https://vtbl.com/portal) | Businesses | Self-serve registration and sign-in, dashboard, generate QR codes, review ID photos and approve/reject, webhook settings, API key management. |
| [`https://vtbl.com/docs/`](https://vtbl.com/docs/) | Business developers | The full integration guide (rendered from `server/src/public/docs/API.md`, with your base URL filled in). |
| [`https://vtbl.com/superadmin`](https://vtbl.com/superadmin) | You (operator) | Sign in with `ADMIN_TOKEN`. Platform analytics, all companies with usage, block/unblock, issue new API keys, live activity feed. |

The super-admin dashboard shows request **metadata only**. ID photos are visible
only to the business that requested them.

Set `SIGNUP_ENABLED=false` to close public registration.

---

## Getting an API key

Businesses register themselves at `/portal` and are shown their API key once
after signing up (and can generate a new one under **Settings & API**).

You can also provision a business yourself, via the admin API:

```bash
curl -X POST https://vtbl.com/admin/businesses \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp", "webhookUrl": "https://acme.example.com/vtbl-webhook"}'
```

or the CLI (run on the server, no network exposure needed):

```bash
cd server && npm run seed -- --name "Acme Corp" --webhook https://acme.example.com/vtbl-webhook
```

Both return a plaintext `apiKey` **exactly once** - store it securely
(secrets manager, not source control). Businesses provisioned this way have no
portal login (API key only). Every business request below is authenticated with:

```
X-API-Key: vtbl_...
```

### Blocking a business

From `/superadmin` (or `POST /admin/businesses/:id/block`). A blocked business's
API key, portal login and outstanding customer capture links stop working
immediately (`403 ACCOUNT_BLOCKED`); no data is deleted, and unblocking restores
everything.

### Super-admin API

All accept `X-Admin-Token: $ADMIN_TOKEN`:

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/overview` | Platform totals, 30-day request series, status breakdown, top companies. |
| `GET /admin/businesses?search=&status=` | Companies with request counts and last activity. |
| `GET /admin/businesses/:id` | One company's analytics and recent requests. |
| `POST /admin/businesses/:id/block` `{reason?}` / `/unblock` | Block or restore access. |
| `POST /admin/businesses/:id/rotate-key` | Issue a new API key (returned once). |
| `GET /admin/activity?limit=` | Newest status events across all companies. |

---

## API reference

Base URL is your VTBL instance's `PUBLIC_BASE_URL` - `https://vtbl.com` for the hosted service.

### Create a verification request

```
POST /api/verifications
X-API-Key: vtbl_...
Content-Type: application/json

{ "customerType": "retail_customer", "customerId": "cust_10293" }
```

`customerType` and `customerId` are opaque strings you define and get back
unchanged on every response - use them to link a verification back to your
own records.

Response `201`:
```json
{
  "id": "b7e2...",
  "token": "1k9F...",
  "status": "PENDING",
  "captureUrl": "https://vtbl.com/verify/1k9F...",
  "qrCodePngBase64": "iVBORw0KGgoAAAANSUhEUgA...",
  "expiresAt": "2026-09-11T15:30:00.000Z",
  "createdAt": "2026-09-11T15:00:00.000Z"
}
```

Render `qrCodePngBase64` as `data:image/png;base64,<value>` to display the QR
code, or send/display `captureUrl` directly. The link expires after
`TOKEN_TTL_MINUTES` (default 30) if unused.

### Get one verification (with full status history)

```
GET /api/verifications/:id
X-API-Key: vtbl_...
```

```json
{
  "id": "b7e2...",
  "customerType": "retail_customer",
  "customerId": "cust_10293",
  "status": "VISUALLY_VERIFIED",
  "hasFrontImage": true,
  "hasBackImage": true,
  "ocrConfidence": 78.4,
  "rejectionReason": null,
  "expiresAt": "2026-09-11T15:30:00.000Z",
  "createdAt": "2026-09-11T15:00:00.000Z",
  "updatedAt": "2026-09-11T15:04:12.000Z",
  "statusHistory": [
    { "status": "PENDING", "label": "ID Verification Requested", "actor": "Acme Corp", "note": null, "createdAt": "..." },
    { "status": "ID_UPLOADED", "label": "ID Uploaded", "actor": "system", "note": null, "createdAt": "..." },
    { "status": "VISUALLY_VERIFIED", "label": "ID Visually Verified by VTBL Software", "actor": "system", "note": null, "createdAt": "..." }
  ]
}
```

### List / poll for changes

```
GET /api/verifications?status=ID_UPLOADED&since=2026-09-11T15:00:00.000Z&customerId=cust_10293
X-API-Key: vtbl_...
```

All query params are optional. `since` filters to records updated after
that ISO timestamp - poll on an interval (e.g. every few seconds) with
`since` set to the last time you polled to cheaply pick up new state
changes instead of using webhooks. Returns `{ "verifications": [...] }`
(same shape as the single-record response, most recently updated first, capped at 200).

### Fetch the uploaded images

```
GET /api/verifications/:id/image/front
GET /api/verifications/:id/image/back
X-API-Key: vtbl_...
```

Streams the raw image (`image/jpeg`, `image/png`, or `image/webp`).

### Record your manual decision

```
POST /api/verifications/:id/decision
X-API-Key: vtbl_...
Content-Type: application/json

{ "decision": "verified" }
```

or

```json
{ "decision": "rejected", "reason": "Photo of back side is blurry" }
```

Sets `MANUALLY_VERIFIED` or `MANUALLY_REJECTED`, permanently recorded with
your business name. Requires both images to already be uploaded (409 if
not). This is a terminal state - call it once you're satisfied.

---

## Getting notified

Both push and pull are supported - use whichever fits your stack.

### Webhooks (push)

Set `webhookUrl` when your business is created. On every status change,
VTBL sends:

```
POST <your webhookUrl>
Content-Type: application/json

{
  "verificationId": "b7e2...",
  "customerType": "retail_customer",
  "customerId": "cust_10293",
  "status": "VISUALLY_VERIFIED",
  "statusLabel": "ID Visually Verified by VTBL Software",
  "timestamp": "2026-09-11T15:04:12.000Z"
}
```

Delivery is best-effort (single attempt, 5s timeout, no retry queue) - treat
it as a low-latency nudge to go fetch the full record, not a guaranteed
delivery channel. Always be able to fall back to polling.

### Polling (pull)

Call `GET /api/verifications?since=<last poll time>` on whatever interval
you like (once a second is fine for a single in-progress verification; for
bulk use, poll less frequently and rely on `since`).

---

## Running it yourself

### Local development

```bash
cp .env.example .env      # edit ADMIN_TOKEN, DB password, etc.
docker compose up --build
```

This starts Postgres and the VTBL app on `http://localhost:3000`
(migrations run automatically on container start). Create your first
business:

```bash
curl -X POST http://localhost:3000/admin/businesses \
  -H "X-Admin-Token: $(grep ADMIN_TOKEN .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Business"}'
```

Then use the returned `apiKey` against the endpoints above.

### Running tests

```bash
cd server
npm install
npm test
```

### Deploying to a VPS

The included stack is: `app` (this service) + `db` (Postgres) + `caddy`
(reverse proxy with automatic Let's Encrypt HTTPS).

1. **Provision a VPS** with Docker and Docker Compose installed, and point a
   DNS `A` record for your chosen domain at its IP.
2. **Clone this repo onto the VPS** (or just copy `docker-compose.yml` and
   `Caddyfile`) into a directory, e.g. `/opt/vtbl`.
3. **Create `/opt/vtbl/.env`** on the VPS from `.env.example`, filling in
   a strong `POSTGRES_PASSWORD`, `ADMIN_TOKEN` (`openssl rand -hex 32`),
   `PUBLIC_BASE_URL=https://yourdomain.com`, and `DOMAIN=yourdomain.com`.
   This file stays on the VPS only - never commit it.
4. **First launch:**
   ```bash
   docker compose --profile prod up -d --build
   ```
   Caddy will automatically obtain a TLS certificate for `DOMAIN` the first
   time it starts, as long as DNS is already pointing at the VPS and ports
   80/443 are reachable.
5. **Set up CI/CD** (optional but included): this repo ships
   `.github/workflows/ci.yml` (runs tests, builds and pushes a Docker image
   to `ghcr.io/<your-repo>` on every push to `main`) and
   `.github/workflows/deploy.yml` (SSHes into your VPS after a successful CI
   run and does a zero-rebuild `docker compose pull && up -d` using the
   image CI just pushed). To enable the deploy workflow, add these repository
   secrets in GitHub (`Settings -> Secrets and variables -> Actions`):

   | Secret | Value |
   | --- | --- |
   | `VPS_HOST` | VPS IP or hostname |
   | `VPS_USER` | SSH user with Docker access |
   | `VPS_SSH_KEY` | Private key for that user (generate a deploy-only key pair) |
   | `VPS_SSH_PORT` | SSH port, if not `22` |
   | `VPS_DEPLOY_PATH` | Path on the VPS holding `docker-compose.yml`/`Caddyfile`, e.g. `/opt/vtbl` |

   The workflow never touches your VPS's `.env` - it only updates which
   image tag is running. If you never add these secrets, the deploy job
   simply won't have credentials to run and you can deploy manually with
   step 4's command instead.
6. **Redeploy manually at any time** with:
   ```bash
   cd /opt/vtbl && docker compose --profile prod pull && docker compose --profile prod up -d
   ```

### Configuration reference

All via environment variables (see `.env.example`):

| Variable | Purpose | Default |
| --- | --- | --- |
| `ADMIN_TOKEN` | Secret for `/admin/*` endpoints and the `/superadmin` login | *(required)* |
| `SESSION_SECRET` | Signs portal / super-admin login cookies | derived from `ADMIN_TOKEN` |
| `BRAND_NAME` | Product name shown in the UIs and API docs | `VTBL` |
| `SIGNUP_ENABLED` | Allow public company registration at `/portal` | `true` |
| `BUSINESS_SESSION_HOURS` / `ADMIN_SESSION_HOURS` | Login session lifetimes | `168` / `12` |
| `ALLOW_PRIVATE_WEBHOOKS` | Permit webhook URLs on private/loopback addresses (dev only) | `false` |
| `PUBLIC_BASE_URL` | Base URL used to build QR/capture links | `http://localhost:3000` |
| `TOKEN_TTL_MINUTES` | Minutes a capture link stays valid | `30` |
| `MAX_UPLOAD_BYTES` | Max size per uploaded image | `10485760` (10MB) |
| `OCR_MIN_CONFIDENCE` | Minimum average OCR confidence (0-100) to auto-pass | `55` |
| `DATABASE_URL` | Postgres connection string | set by docker-compose |
| `DOMAIN` | Domain Caddy requests a certificate for (prod profile only) | - |

---

## Limitations / honesty notice

VTBL's automated "visual verification" is a heuristic OCR check
(legibility + ID-number/date format sanity checks via `tesseract.js`), not a
certified identity-verification or KYC/AML product. It is **not
banking-grade**. Treat `VISUALLY_VERIFIED`/`VISUALLY_REJECTED` as a fast
pre-screen, and use the manual decision endpoint as your actual system of
record before relying on a verification for compliance purposes.

---

## Project layout

```
idVerifier/
  docker-compose.yml       # app + Postgres + Caddy stack
  Caddyfile                 # reverse proxy / automatic HTTPS config
  .env.example
  .github/workflows/        # CI (test+build+push) and CD (VPS deploy)
  server/
    src/
      routes/                admin.ts, portal.ts, verifications.ts, public.ts
      services/               qrcode, ocr, webhook, storage, status labels
      middleware/             API key / portal session + admin auth
      public/verify/          mobile ID-capture web page
      public/portal/          company web portal
      public/superadmin/      super-admin dashboard
      public/docs/            API.md (integration guide) + renderer
      public/shared/          shared UI css/js
    prisma/                  schema + migrations
    tests/                   unit tests (vitest)
```
