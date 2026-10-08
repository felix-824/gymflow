# Next steps: October 9, 2026

Timezone: Asia/Seoul. Written October 8, 2026.
**Status vocabulary:** **Completed** = implemented or verified in this session; **Confirmed direction** = user-selected product intent; **Proposed** = future design/work; **Blocked** = known blocker; **Not verified** = unavailable evidence or an unrun check.

This is a **Proposed** work queue, not a scheduled automation or a commitment to deliver the whole domain migration in one day. Priority order applies across categories: establish a reliable baseline before implementing new contracts.

## Backend cleanup

| Priority | Task | Status | Dependency | Completion criterion |
| --- | --- | --- | --- | --- |
| P0 / 1 | Review and repair the missing lookupFavorite and lookupVisit helpers and incorrect getFavorites delegation | Proposed | Review actual favorites/history aggregation semantics | Both app typechecks pass; focused favorites/history behavior tests pass |
| P0 / 2 | Repair ESLint dependency/configuration mismatch in a separate tooling change | Proposed | Inspect installed versions, lockfile, and config requirements | Non-fixing lint loads successfully; remaining diagnostics reported; no blanket auto-format |
| P1 / 3 | Plan authentication hardening: safe signup/self-update inputs, password-change hashing, minimal JWT claims, current account checks, private/public data separation | Proposed | Explicitly scoped backend change | Reviewed contract and focused regression cases; no accidental privilege escalation |
| P1 / 4 | Review upload target validation and sensitive logging | Proposed | Inspect upload paths and log payloads | Scoped implementation plan plus rejection/redaction cases |
| P1 / 5 | Approve the first gym-domain slice and shared-code boundary | Proposed | Stable baseline; decisions D10–D20 | Agree on gym fields, per-gym permissions, public/private contracts, persistence, and test approach |
| P2 / 6 | Plan fresh-database setup and seed data without touching existing connections | Proposed | Approved gym schemas and environment strategy | Reviewed provisioning/rollback checklist; no automatic copying or deletion of Nestar data |

**Blocked baseline:** the API has three known compiler errors and lint cannot load typescript-eslint. These remain real blockers; documenting them did not resolve them. Batch typechecking previously passed.

## Frontend migration

| Priority | Task | Status | Dependency | Completion criterion |
| --- | --- | --- | --- | --- |
| P1 / 7 | Locate and inspect the actual Next.js repository | Proposed | User supplies/access enables the frontend location | Verified router, routes, components, client, operations, scripts, and codegen inventory |
| P1 / 8 | Capture frontend checks and prepare a branding-only diff | Proposed | Verified frontend inventory | Baseline results recorded; no server operation/response changes from branding |
| P2 / 9 | Replace illustrative mappings with actual file mappings | Proposed | Frontend inventory and approved gym API design | Every old/new route/component has a verified path or explicit new-file proposal |
| P2 / 10 | Plan the first discovery screen and client-contract update | Proposed | Implemented or agreed gym list/detail contracts | Reviewed variables/selections/types/cache updates and UI states |

**Not verified:** all frontend route/component names currently in the migration document. The mappings in [FRONTEND_MIGRATION.md](FRONTEND_MIGRATION.md) are proposals, not instructions to rename unknown files blindly.

## Testing

| Priority | Task | Status | Dependency | Completion criterion |
| --- | --- | --- | --- | --- |
| P0 / 11 | Rerun both no-emit typechecks after baseline fixes | Proposed | Backend task 1 | Capture exit codes and diagnostics; no new errors |
| P0 / 12 | Run non-fixing lint after tooling repair | Proposed | Backend task 2 | Config loads; distinguish old findings from regressions |
| P1 / 13 | Review e2e harness and establish an isolated database strategy | Proposed | Inspect both test configs and app bootstrap | Tests cannot target an existing live database or accidentally run ranking jobs |
| P1 / 14 | Add focused auth/favorites/history regressions with their fixes | Proposed | Scoped implementations | Tests verify behavior, not only renamed symbols |
| P2 / 15 | Define gym-domain acceptance tests | Proposed | Approved first domain slice | Cross-gym denial, public/private access, membership validity, concurrent last-seat booking, cancellation, duplicate attendance, timezone boundaries |
| P2 / 16 | Run frontend checks and integration flows | Proposed | Actual frontend plus agreed test backend | Report real command results and relevant browser-flow evidence |

Do not execute database-connected suites before their isolation is established. No such suite ran in the completed rename or documentation task.

## Documentation

| Priority | Task | Status | Dependency | Completion criterion |
| --- | --- | --- | --- | --- |
| P1 / 17 | Review these six docs for factual accuracy and product scope | Proposed | Current documentation draft | Completed vs proposed distinctions remain clear; no secrets |
| P1 / 18 | Record validation evidence when blockers are fixed | Proposed | New checks actually run | Date, commands, results, and source revision captured |
| P2 / 19 | Update architecture decisions and GraphQL mappings after approval | Proposed | Accepted backend/frontend contracts | Proposed names replaced only when supported by implementation evidence |
| P2 / 20 | Keep GymFlow naming consistent in future docs and commit messages | Proposed | None | Petoria inconsistency is explained without rewriting existing history |

The working tree was clean before this documentation task. Review the documentation-only diff before any commit; this task does not authorize staging, committing, or deployment.

Related: [Completed work](COMPLETED_TASKS.md), [Decisions](DECISIONS.md), [Prompts](PROMPTS.md).
