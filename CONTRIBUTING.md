# Contributing

Thanks for helping people take their data back. Please read the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to help

1. **Registry** (most valuable): verify a broker's privacy contact on its official site, record the exact source URL
   and date, and change its `verification.status`. Never copy contact data from CC BY-NC-SA or proprietary lists.
   The registry has its own guide: [docs/04-registry.md](./docs/04-registry.md).
2. **Reply classifier**: real-world broker replies (anonymised!) make `src/requests/reply-classifier.ts` better.
   Add a case to `reply-classifier.spec.ts`.
3. **Code**: keep `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build` green.

## Workflow

1. Fork, branch from `main`, make a focused change.
2. Run the checks locally. `npm run test:e2e` needs MongoDB (`E2E_MONGODB_URI`, default `mongodb://127.0.0.1:27099`),
   for example `docker run -d -p 27099:27017 mongo:7`.
3. Open a pull request. **The PR title becomes the commit message on `main`** (squash merge) and must follow
   [Conventional Commits](https://www.conventionalcommits.org): `feat(scope): ...`, `fix: ...`, `docs: ...`,
   `registry: ...` (see `release-please-config.json` for the accepted types). Releases and the changelog are generated
   from these titles.
4. All required checks must pass and conversations must be resolved. `main` only accepts pull requests; there are no
   exceptions, including for maintainers.

An API change is a change in two repositories: update `docs/api-types.ts`, `docs/API-CONTRACT.md` and
`docs/openapi.json` (`npm run openapi`) here, copy `api-types.ts` verbatim to the frontend, and link the two PRs.

## Ground rules

- TypeScript strict, no `any` in `src/`.
- Personal data is encrypted at rest and never logged. New fields holding PII go through `CryptoService`.
- Operations that can run twice must be idempotent (the service runs on several instances).
- New behaviour needs an e2e test through the real HTTP app (`test/*.e2e-spec.ts`).
- Do not weaken the dry-run default or the "only `verified` entries are contacted automatically" rule.
- Never commit secrets or `.env` files; GitHub push protection and gitleaks will reject them.
- New dependencies need a compatible license (`npm run check:licenses`) and a reason in the PR description.

## License

By contributing you agree that your code is released under AGPL-3.0-only and your changes to `registry/` under
CC BY-SA 4.0.
