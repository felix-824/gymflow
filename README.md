# GymFlow backend

NestJS 10 GraphQL/Apollo monorepo for trainer-owned Programs, reservations, reviews,
members, and Community. API and batch keep the existing NestJS/Mongoose structure.

Use Node 22.x, npm 10.9.2, and the committed package-lock.json.
The canonical [release readiness runbook](docs/ai/PRODUCTION_READINESS.md) covers
both repositories: environment, routing, persistent storage, smoke gates, backups,
and rollback. Examples in .env.example contain no deployment credentials.

| Application | Development | Build | Production |
| --- | --- | --- | --- |
| gymflow-api | npm run start:dev | npm run build -- gymflow-api | npm run start:prod |
| gymflow-batch | npm run start:dev:batch | npm run build -- gymflow-batch | npm run start:prod:batch |

For a release, install with `npm ci --include=dev`, build both applications, then
run their production commands under a process supervisor with injected runtime
configuration. Run one API with persistent uploads and one batch scheduler.
API and batch use the same intentional transaction-capable MongoDB database.
Batch's HTTP port is internal; it does not implement the API health/readiness routes.

Unit tests: `npm test -- --runInBand`. Disposable integration:
`npm run test:integration` (owned MongoDB, never the application database).
Non-fixing lint: `node node_modules/eslint/bin/eslint.js --config eslint.config.mjs "apps/**/*.ts" --no-fix`.
The package lint script auto-fixes; do not use it for a read-only review.

Read AGENTS.md and docs/ai before implementation. Deployment, provisioning, Chat,
payments, and full notification delivery require separately authorized work.
