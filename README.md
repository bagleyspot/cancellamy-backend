# Cancellamy · backend

[![CI](https://github.com/bagleyspot/cancellamy-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/bagleyspot/cancellamy-backend/actions/workflows/ci.yml)
[![CodeQL](https://github.com/bagleyspot/cancellamy-backend/actions/workflows/codeql.yml/badge.svg)](https://github.com/bagleyspot/cancellamy-backend/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/bagleyspot/cancellamy-backend/badge)](https://scorecard.dev/viewer/?uri=github.com/bagleyspot/cancellamy-backend)
[![License: AGPL-3.0](https://img.shields.io/badge/code-AGPL--3.0-blue.svg)](./LICENSE)
[![Registry: CC BY-SA 4.0](https://img.shields.io/badge/registry-CC%20BY--SA%204.0-lightgrey.svg)](./registry/LICENSE)

Free, open-source (AGPL-3.0 code, CC BY-SA 4.0 registry data) service that exercises GDPR rights **on behalf of people in Italy**: it sends
erasure and objection requests (artt. 17 and 21 GDPR) to data brokers, tracks the 30-day deadline, sends reminders,
re-checks periodically and prepares a complaint to the *Garante per la protezione dei dati personali* when a broker
does not answer.

This repository is the API (NestJS 11, TypeScript strict, MongoDB). The web app lives in `cancellamy-frontend`.

📚 **Full documentation (Italian): [docs/README.md](./docs/README.md)**: user guide, request lifecycle, registry, installation, deploy, architecture, API, security/privacy/legal, operations, development.

> **Not legal advice.** Cancellamy cannot guarantee that a broker deletes your data. Credit bureaus, KYC databases
> and public registers can lawfully refuse. The registry says so per entry (`obstacles`).

## What it does

| Area | Behaviour |
|---|---|
| Accounts | Email + password (argon2id), email verification, password reset, rotating refresh cookie with reuse detection, lockout, rate limits |
| Profiles | Up to `MAX_PROFILES_PER_USER` people per account (family). Personal data is encrypted at rest (AES-256-GCM, field level) |
| Delega | The user signs an authorization (typed name must match). A PDF with the signature hash is attached to every email. Revocable |
| Registry | 490+ brokers in `registry/brokers.yaml` (provenance and license per entry). Only `verified` entries are contacted automatically |
| Requests | Email (via Resend) or guided manual action (web form, phone, PEC, the RPO). Italian or English text depending on the broker |
| Replies | Inbound webhook (`email.received`), matching by reply address + reference code + sender domain, heuristic classification (completed / refused / id required / more info) |
| Deadlines | Overdue after 30 days, two automatic reminders, manual reminder, complaint draft (text + PDF), renewal every 90 days |
| Extras | Custom removals, notifications (in-app + email), monthly reports, data export (art. 20), account deletion, admin area |
| Advanced | Send from the user's own mailbox (SMTP), evidence dossier (SHA-256 manifest, RFC 3161 timestamp), contact verification and right-of-access requests ("Cosa sai di me") with a data map, breach check (Have I Been Pwned, optional), search-engine delisting guide, public broker leaderboard (privacy threshold), telemarketing defence. See `docs/12-funzionalita-avanzate.md` |
| Safe by default | `MAIL_MODE=dry-run`: emails are recorded, never sent, and replies can be simulated |

Documents (ID cards) are **never stored**: they are forwarded to the broker and only metadata is kept.

## Quick start

```bash
docker compose up -d mongo            # or point MONGODB_URI at your own MongoDB
cp .env.example .env                  # edit secrets, see below
npm ci
npm run start:dev                     # http://localhost:3000/api/v1, Swagger at /api/docs
```

Generate secrets: `openssl rand -base64 48` (JWT) and `openssl rand -base64 32` (`DATA_ENCRYPTION_KEY`).
Losing `DATA_ENCRYPTION_KEY` makes stored personal data unreadable: back it up.

The first user whose email is listed in `ADMIN_EMAILS` becomes an admin at registration.

## Self-hosting

A complete stack (MongoDB + API + web) starts with one command, see [selfhost/README.md](./selfhost/README.md). The public
instance and any self-hosted one run the same code; every capability that needs an external service (SMS, breach
check, timestamp authority) is optional and switches itself off when its key is missing. Operators can also switch
features off with `FEATURES_DISABLED`.

## Scripts

| Command | What |
|---|---|
| `npm run build` | Compile to `dist/` |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | Unit tests (no database) |
| `npm run test:e2e` | End-to-end tests against a real MongoDB (`E2E_MONGODB_URI`, default `mongodb://127.0.0.1:27099`) |
| `npm run openapi` | Writes `docs/openapi.json` (needs MongoDB) |

The e2e suite drives the real HTTP app: auth, profiles, delega, activation, sending, retries, replies, webhook
signatures, deadlines (with a fake clock), renewals, admin, export/delete and two concurrent instances.

## Configuration

All configuration is environment based (see `.env.example`, validated at boot in `src/config/app-config.ts`).
Highlights: `MAIL_MODE` (`dry-run` | `resend`), `MAIL_FROM`, `INBOUND_DOMAIN`, `RESEND_API_KEY`,
`RESEND_WEBHOOK_SECRET`, `APP_URL`, `CORS_ORIGINS`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `OPERATOR_NAME`,
`MAX_PROFILES_PER_USER`, `CUSTOM_REQUESTS_PER_MONTH`, `RESPONSE_DEADLINE_DAYS`, `REMINDER_INTERVAL_DAYS`,
`RENEWAL_DAYS`, `CRON_SECRET`.

### Sending for real with Resend

1. Verify your sending domain in Resend and set `MAIL_FROM` to an address on it (SPF/DKIM).
2. Enable **receiving** for an inbound domain (for example `in.example.org`) and set `INBOUND_DOMAIN`.
   Broker replies go to `r-<token>@INBOUND_DOMAIN`, one address per profile.
3. Create a webhook for the `email.received` event pointing to `https://<api>/api/v1/webhooks/resend` and put its
   signing secret in `RESEND_WEBHOOK_SECRET`. Signatures are verified (Standard Webhooks) and deliveries are
   idempotent.
4. Set `MAIL_MODE=resend` and `RESEND_API_KEY`. Review the registry first: automatic sending only targets entries
   with `verification.status: verified`; admins can enable more from the admin area.

In development `src/load-env.ts` loads `.env` if present; in production only real environment variables are used.

## Deploying on Cloud Run

The service is stateless and safe with many instances:

- Listens on `PORT`, exposes `GET /health` (liveness) and `GET /health/ready` (MongoDB ping), handles SIGTERM.
- JSON logs on stdout with `severity` (Cloud Logging), secrets only from environment / Secret Manager.
- One MongoDB client per instance (`maxPoolSize: 10`): size the Atlas pool as instances × 10.
- Jobs: Cloud Run throttles CPU between requests, so trigger the scheduler from **Cloud Scheduler**:
  `POST /internal/cron/tick` every minute with header `x-cron-secret: $CRON_SECRET`. Ticks are idempotent: a
  MongoDB lease admits one runner, and each task claims its work atomically.
  Set `SCHEDULER_ENABLED=false` in that setup (or keep CPU always allocated and leave the in-process timer on).
- Build: `docker build -t cancellamy-backend .` (multi-stage, runs as non-root).

## Architecture

```
src/
  config/      validated environment
  db/          Mongoose schemas (one file) and DbModule
  auth/ users/ register, login, refresh rotation, /me, export, delete
  profiles/    profile CRUD, delega, PDF, activation
  brokers/     registry loader, public catalogue, admin edits
  requests/    channel planning, state machine, engine (send, reply, overdue, renew), user actions
  inbound/     Resend webhook, matching, unmatched queue
  scheduler/   lease + periodic tasks, cron endpoint
  notifications/ reports/ pdf/ templates/ mail/ admin/ health/
registry/brokers.yaml   the data broker registry (see below)
docs/                   API contract (api-types.ts, API-CONTRACT.md) and openapi.json
```

State machine of a request: `queued → sent → (replied | overdue | completed | refused | action_required)`,
`overdue → escalated`; manual requests start in `action_required`. Transitions are validated centrally
(`src/requests/status.ts`).

## The registry

`registry/brokers.yaml` is the project's most valuable asset. Every entry records where each fact came from and
under which license (`provenance`), and whether a human verified the contact (`verification.status`). Entries
derived from CC BY-NC-SA lists keep only name and URL. Improving it is the best way to contribute: verify a
channel on the broker's official site, then open a pull request changing `needs_research` / `third_party` to
`verified` with the source URL and date.

> **Pre-release.** The privacy and terms pages in the web app are placeholders pending legal review, the DPIA is not
> done, and real email sending (`MAIL_MODE=send`) has not been tested end to end against live providers.

## License

Code: [AGPL-3.0-only](./LICENSE). Registry data (`registry/`): [CC BY-SA 4.0](./registry/LICENSE), with
attribution in [`registry/ATTRIBUTION.md`](./registry/ATTRIBUTION.md). If you run a modified version as a network service you must offer its source to the
users (section 13): keep the "source code" link in the web app pointing at your fork.
