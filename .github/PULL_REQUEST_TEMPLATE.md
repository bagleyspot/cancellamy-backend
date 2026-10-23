<!-- The PR title becomes the commit message on main: use Conventional Commits, e.g. "fix(requests): ..." -->

## What and why

## How it was tested

- [ ] `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build`
- [ ] New behaviour has a test (e2e through the real HTTP app when it touches the API)

## Checklist

- [ ] No secrets, `.env` files or personal data in the diff
- [ ] Personal data stays encrypted at rest and out of the logs
- [ ] Operations that can run twice are idempotent (multi-instance deployment)
- [ ] API change: `docs/api-types.ts`, `docs/API-CONTRACT.md` and `docs/openapi.json` updated, and the frontend change is linked
- [ ] Registry change: source URL and date recorded, license of the source compatible with CC BY-SA 4.0
