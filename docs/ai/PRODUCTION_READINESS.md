# API production readiness

Phase 17I-C keeps one API instance with filesystem-backed uploads. Set production
`UPLOAD_ROOT` to an absolute application directory on a persistent mounted volume,
not a filesystem root. Development defaults to the resolved CWD `uploads` directory;
an absolute override is supported there too. Image URLs and stored paths remain
`uploads/member|article|program/<image>`, served under `/uploads`.

Startup validates configuration, awaits 17I-B Mongo connection/topology/index/transaction
readiness, then creates/checks the upload root, `.tmp`, `member`, `article`, and
`program` directories. A unique owned temporary file is hard-linked into each final
directory and the root, read back, and removed. This tests actual write/read/unlink
and same-filesystem publication capability without inspecting user uploads.
Cleanup failures reject startup. No index repair, user-upload deletion, or business
write is added by these probes. The existing idempotent programRevision backfill
runs during Nest initialization after storage passes; traffic starts after all hooks.

`GET /health` is unauthenticated process liveness: HTTP 200, `{"status":"ok"}`.
`GET /ready` is HTTP 200 `{"status":"ready"}` only after initialization and successful
upload startup verification, with a currently connected Mongo connection and successful
read-only ping (2-second driver timeout). Otherwise it is HTTP 503
`{"status":"not_ready"}`. It reports no configuration, paths, or failure diagnostics.
Readiness is cleared during application shutdown. Polls do not rebuild indexes or
repeat filesystem write probes; upload capability is stored startup state.

Production disables GraphQL Playground and schema introspection; ordinary Apollo
operations and `__typename` remain available. Development keeps both enabled.
Central formatting preserves application HTTP 4xx validation/auth/conflict messages,
existing fixed legacy business messages that use HTTP 500, the upload-busy response,
and the four existing program conflict reasons. Unexpected errors return only
`Internal server error` / `INTERNAL_SERVER_ERROR`; raw exception extensions and
stack traces are never forwarded. Production GraphQL request-validation diagnostics
are fixed messages to avoid echoing submitted values. Development keeps detailed messages.

Filesystem capability checks cannot prove durability through container replacement,
future disk capacity, or later permission changes. Operators must mount and preserve
the configured volume and monitor it. Mongo ping is current reachability, not a repeat
topology/index audit. Multi-instance uploads, provisioning, TLS/proxy setup, Linux
deployment validation, backups, and deployment are outside this phase.

Validation on October 18, 2026 used an isolated source snapshot with owned temporary
storage and disposable MongoDB only: 19 unit suites / 712 tests and 18 integration
suites / 824 tests passed. New focused coverage passed 48 unit checks and 10 production
integration checks. API/batch no-emit TypeScript and Nest builds passed; all 12 changed
TypeScript files passed non-fixing lint. Applied worktree API/batch TypeScript also
passed. An invalid-root compiled production bootstrap exited 1 with a fixed diagnostic
before attempting Mongo connection. No existing application database was used for tests.
