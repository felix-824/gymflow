# Session prompts and reusable handoff prompts

Snapshot: October 8, 2026 (Asia/Seoul).
**Status vocabulary:** **Completed** = implemented or verified in this session; **Confirmed direction** = user-selected product intent; **Proposed** = future design/work; **Blocked** = known blocker; **Not verified** = unavailable evidence or an unrun check.

## Session prompts worth retaining

The following prompts are condensed English restatements of session requests, not verbatim transcripts.

### 1. Repository analysis — Completed

> Analyze the current Nestar NestJS GraphQL monorepo for migration to GymFlow. Inspect actual apps, modules, schemas, GraphQL operations, jobs, configuration, and tests. Separate reusable infrastructure from real estate business logic. Ask about product scope and data compatibility before finalizing a migration plan.

### 2. Naming-only refactor — Completed

> Plan and then implement a safe Nestar → GymFlow naming layer. Rename package/app identifiers, folders, paths, branding, and related test references. Keep APIs, domain logic, MongoDB collections/schemas, environment keys/values, ports, schedules, and dependencies unchanged. Preserve existing user edits. Run lint without fixes and both no-emit typechecks; report pre-existing failures separately. Do not start services or database-connected tests.

### 3. Pre-commit diff review — Completed

> Show every change made in this session before commit. Map renamed files to their originals, show added/removed lines, list files moved without content changes, and distinguish user edits. Do not edit files, stage changes, or commit.

### 4. Documentation handoff — Confirmed direction

> Create only docs/BACKEND_MIGRATION.md, DECISIONS.md, FRONTEND_MIGRATION.md, COMPLETED_TASKS.md, NEXT_STEPS.md, and PROMPTS.md. Use Nestar → GymFlow. Separate completed work, confirmed direction, proposals, blockers, and unverified claims. Treat frontend mappings as proposals until its repository is inspected. Do not modify source, existing docs, configuration, secrets, or Git history.

## Reusable next-session prompts — Proposed

### Start with repository truth

> Read AGENTS.md and all six migration documents under docs/. Inspect Git status, current commit, and relevant source before acting. Summarize what is implemented, what remains proposed, and which validation results are historical. Preserve user edits. Use GymFlow as the product name; the Petoria wording in commit 679d0d5 is historical metadata. Do not infer a frontend repository or expose environment values.

### Fix the API baseline in a focused change

> Inspect the missing lookupFavorite/lookupVisit exports and getFavorites delegation. Propose the smallest correction that preserves the current real estate API contract and favorites/history behavior, then implement the approved scope. Add focused behavior tests where needed. Run both no-emit app typechecks. Do not rename domain models or collections, introduce gym APIs, change connection settings, or start services against an existing database. Report any remaining failures explicitly.

### Repair lint tooling separately

> Diagnose why eslint.config.mjs imports an unavailable typescript-eslint package. Inspect package.json, lockfile, installed versions, and supported config APIs before selecting a fix. Propose a minimal dependency/configuration repair without broad upgrades. Run ESLint with --no-fix; report remaining source diagnostics rather than automatically formatting the repository. Do not mix domain changes into the tooling fix.

### Inspect the frontend before editing

> The frontend repository is located at <FRONTEND_REPOSITORY_PATH>. Read its local instructions and inspect its Next.js router, routes, components, auth, GraphQL documents/client, generated types, uploads, WebSockets, and scripts. Replace illustrative migration mappings with verified paths and current operation names. Report baseline checks. Do not edit application files in this inspection step or change backend contracts.

### Plan the first gym-domain slice

> Plan a GymFlow gym-discovery and ownership slice using the current backend and DECISIONS.md. Product direction: independent gyms, users can join multiple gyms, discovery plus core operations, offline payments, and a future fresh database. Distinguish user accounts, gym-scoped staff permissions, trainer profiles, and purchased memberships. Inspect existing code first, ask about unresolved product semantics, and propose interfaces, data models, compatibility, concurrency, test isolation, and rollout before coding. Do not treat proposed names in FRONTEND_MIGRATION.md as an approved schema.

### Implement an approved slice

> Implement only <APPROVED_SLICE_OR_PLAN>. First verify repository state and accepted contracts. Preserve unrelated edits and keep each change attributable to the slice. Add tests for the specified behavior and permission boundaries. Use an explicitly isolated test database when integration tests are required. Run relevant validation, review the diff, update only the migration docs affected by completed work, and report limitations. Do not deploy, migrate live data, stage, or commit unless separately requested.

### Review security findings

> Verify the documented signup/self-update role exposure, password-update hashing, JWT payload/status handling, upload target handling, and sensitive logging in current code. Produce a prioritized, evidence-based fix plan with regression cases and contract impacts. Do not claim exploit validation or live-data exposure without evidence. Do not modify unrelated business logic or disclose credentials.

### Refresh the six migration documents

> Update only the six files in docs/ using current source, Git history, and actual validation evidence. Mark each statement Completed, Confirmed direction, Proposed, Blocked, or Not verified as appropriate. Preserve historical test results with dates; do not imply checks were rerun. Keep frontend names illustrative until verified, explain naming inconsistencies, and exclude secrets. Verify links and ensure the diff is documentation-only.

### Read-only review before commit

> Show the current diff against <BASE_REVISION>. Include unstaged and staged work and relevant new files without changing the index. Resolve directory renames when summarizing file changes. List added/removed lines and distinguish unchanged moved files, assistant edits, and pre-existing user changes where evidence permits. Do not stage, commit, format, or edit anything.

## Baseline validation commands

The commands below were used for the completed naming refactor. Rerun only when appropriate to a later implementation task; this documentation task does not run them.

```powershell
node node_modules/eslint/bin/eslint.js --config eslint.config.mjs "apps/**/*.ts" --no-fix
node node_modules/typescript/bin/tsc -p apps/gymflow-api/tsconfig.app.json --noEmit --incremental false
node node_modules/typescript/bin/tsc -p apps/gymflow-batch/tsconfig.app.json --noEmit --incremental false
```

**Blocked:** API typecheck had three known errors and lint could not load typescript-eslint. **Completed:** batch typecheck passed. **Not verified:** e2e/database-connected tests, frontend checks, and deployment. See [COMPLETED_TASKS.md](COMPLETED_TASKS.md) for exact historical evidence.

Related: [Next steps](NEXT_STEPS.md), [Backend state](BACKEND_MIGRATION.md), [Frontend proposal](FRONTEND_MIGRATION.md), [Decisions](DECISIONS.md).
