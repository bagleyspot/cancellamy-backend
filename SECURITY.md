# Security policy

Cancellamy handles personal data, so security reports are taken seriously.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting:
[Report a vulnerability](https://github.com/bagleyspot/cancellamy-backend/security/advisories/new)
(Security tab → Report a vulnerability). Include what you found, how to reproduce it and the impact.

What to expect: an acknowledgement within 5 working days, a first assessment within 10 working days, and a fix or a
mitigation plan for confirmed issues, coordinated with you before public disclosure. Credit is given in the advisory
unless you prefer to stay anonymous.

For the frontend, use the same form in `cancellamy-frontend`. For a public instance run by someone else, contact its
operator (`SUPPORT_EMAIL`).

## Supported versions

The project is pre-1.0: only the latest release and `main` receive security fixes.

## Scope

In scope: the API, the web app, the Docker images and the self-hosting stack in these repositories.
Out of scope: social engineering, denial of service by volume, findings that need a compromised host or an already
privileged admin account, and third-party services (Resend, MongoDB hosting, brokers).

Please do not test against other people's data or against live brokers, and do not send requests through a public
instance on behalf of people who have not consented.

## Design notes useful for reviewers

- Passwords: argon2id. Login lockout after 10 failures (15 minutes), generic error messages.
- Sessions: 15-minute JWT access token (memory only in the web app) + rotating opaque refresh token in an httpOnly
  cookie, with reuse detection that revokes the whole token family.
- Personal data (profiles, signatures, message bodies, SMTP settings) is AES-256-GCM encrypted at field level; the key
  comes from `DATA_ENCRYPTION_KEY`.
- Identity documents are forwarded and never stored.
- Webhooks are verified with Standard Webhooks signatures (5-minute tolerance) and deduplicated.
- The cron endpoint requires a shared secret compared in constant time.
- Outbound SMTP to user-supplied servers goes through an SSRF guard (`src/sender/net-guard.ts`).
- The default `MAIL_MODE=dry-run` never contacts brokers or user mail servers.

## Repository safeguards

`main` is protected (pull request and passing checks required, no force-push), GitHub secret scanning with push
protection and Dependabot alerts are on, CI runs CodeQL, dependency review, gitleaks and a container scan, and
release images are published with provenance and SBOM attestations.
