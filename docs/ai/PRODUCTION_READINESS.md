# GymFlow release and production readiness

Canonical operator contract for the sibling gymflow-next frontend and gymflow backend.
17I-D prepares release QA; it does not authorize deployment. Domains and volume
paths below are examples. No production resources have been provisioned or verified.

## Existing 17I-C API gates

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

## Toolchain and artifacts

Both repositories declare Node 22.x. Use Yarn 1.22.22 with frontend yarn.lock and
npm 10.9.2 with backend package-lock.json. The frontend is Next.js 15.5.28 Pages
Router/React 18.2.0; the backend is NestJS 10, code-first GraphQL/Apollo and Mongoose.
Install development dependencies in the build environment. Keep the frontend
postinstall Toast UI 3.2.2 patch enabled; do not use ignore-scripts.
Backend test installs may use MONGOMS_DISABLE_POSTINSTALL=1 to skip the development
MongoDB binary download; this is not an application production variable.

Record the frontend/backend commit pair, lockfile hashes, tool versions, public URLs,
artifact IDs and secret/volume version identifiers for each release. Never record
secret values. Promote complete artifacts, not mixed build files. Do not copy local
.env files, uploads or development databases into a release.

## Environment contract

### Frontend: build inputs versus runtime

next.config.js explicitly exposes REACT_APP_ values through its env option, despite
their not having a NEXT_PUBLIC_ prefix. They are public build inputs. Supply both
required URLs before building; changing runtime variables alone does not rewrite
browser assets. Rebuild when changing public origin.

| Variable | Phase | Current contract |
| --- | --- | --- |
| REACT_APP_API_URL | Required at build | Public HTTPS media/API base; use the canonical origin, e.g. https://gymflow.example. Trailing slash is normalized away. |
| REACT_APP_API_GRAPHQL_URL | Required at build | Absolute public HTTPS URL with non-root endpoint path; recommended https://gymflow.example/graphql. |
| REACT_APP_API_WS | Optional build input | Legacy exposed value; no active MVP WebSocket connection. Leave unset. |
| NODE_ENV | Build/start | production; Next build/start select production when unset. |
| PORT | Runtime | Frontend listen port, normally 3000; start's --port option can specify it. |

Production URL validation rejects missing/literal undefined, malformed or relative
URLs, HTTP, whitespace, credentials, query strings/fragments and the specific
loopback hosts checked in libs/config.ts. Validation does not test reachability:
deployment routing must connect the configured URL to the actual API /graphql handler.

### Backend: runtime inputs

ConfigModule reads .env from the process CWD; injected environment takes precedence.
Use the repository/build root as CWD. Both production scripts force NODE_ENV=production.
API and batch share Mongo configuration; batch does not consume auth/upload settings.

| Variable | Consumer | Current contract |
| --- | --- | --- |
| NODE_ENV | Both | production enables Mongo gates; API also applies production GraphQL/cookie/storage policy. |
| PORT_API | API | Set explicitly, e.g. 3007. Code fallback is 3000. Restrict to internal routing/firewall. |
| PORT_BATCH | Batch | Set explicitly, e.g. 3008. Code fallback is 3000. Keep internal; no public routing. |
| MONGO_PROD | Both, required | Valid mongodb:// or mongodb+srv:// URI selecting an intentional usable application DB on a writable transaction-capable topology. |
| SECRET_TOKEN | API, required | Independent random secret of at least 32 UTF-8 bytes; not literal undefined. |
| SECRET_REFRESH_TOKEN | API, required | Same minimum; must differ from SECRET_TOKEN. |
| AUTH_ALLOWED_ORIGINS | API, required | Comma-separated exact HTTPS browser origins; no wildcard, path or trailing slash. |
| UPLOAD_ROOT | API, required | Absolute application directory, not filesystem root; persistent storage writable by the API identity. |
| MONGO_DEV | Development only | Neither production start command selects it. |

.env.example is a secret-free template. Replace examples in deployment configuration,
not by committing credentials. No other application production variables are required
by current source. Backend ConfigModule does not automatically select .env.production.

## Recommended MVP topology and routing

Internet -> canonical HTTPS origin/domain -> reverse proxy -> Next.js + one NestJS
API. API and one batch scheduler connect to the same transaction-capable MongoDB.
Only the API owns the persistent upload volume.

| Public path | Destination |
| --- | --- |
| / and frontend routes/assets, including /_next/* | Next.js, normally internal port 3000 |
| /graphql | API, normally internal port 3007 |
| /uploads/* | API static middleware, same API port |
| /health and /ready | API operational handlers, same API port |

Preserve paths; no vendor-specific proxy or rewrite is implemented here. Preserve
Origin, Authorization, Cookie, Set-Cookie and Apollo-Require-Preflight; support JSON
POST, multipart uploads and CORS OPTIONS. Do not cache GraphQL/auth responses or
readiness, or log credentials/multipart contents. Restrict direct Internet access
to API/batch listen ports. Coordinate proxy limits with five images, 5 MiB per
image and the API's 30-second HTTP request timeout. JPEG/PNG/WebP retrieval gets
nosniff; temporary and non-image paths remain blocked.

Production refresh cookie: __Host-gymflow_refresh; Secure, HttpOnly, SameSite=Lax,
Path=/, no Domain. Public HTTPS and unchanged Set-Cookie attributes are required;
do not add Domain or rewrite Path. Browser Apollo uploads and refresh/logout use
credentials: include. Auth mutations require Apollo-Require-Preflight: true; an
Origin header, when present, must match AUTH_ALLOWED_ORIGINS exactly. Current source
permits absent Origin for non-browser/server-side requests; that does not replace
browser CORS validation. Access tokens remain in memory; refresh sessions are in Mongo.
Same-origin routing avoids CORS/cookie friction. Separate same-site HTTPS origins
still require exact CORS configuration and browser verification; cross-site cookies
may be withheld under SameSite=Lax. Do not weaken cookie security.

## Mongo and storage prerequisites

Production rejects standalone MongoDB. Use a writable replica set or compatible
mongos/Atlas topology with logical sessions, supported wire versions and real
transaction support. Select an explicit usable application DB, not admin/local/config/test;
require primary reads, acknowledged writes and transaction-compatible read concern.
Validate target network access and permissions. SRV parsing and simulated mongos
metadata are not evidence of a tested production Atlas deployment.

17I-B disables automatic production index/collection creation and explicitly verifies
nine correctness contracts (native _id indexes remain):

| Collection | Required index |
| --- | --- |
| programCreateRequests | unique memberId + createRequestId |
| reviews | unique reservationId |
| trainerSchedules | unique memberId + dayOfWeek |
| follows | unique followingId + followerId |
| likes | unique memberId + likeRefId + likeGroup |
| views | unique memberId + viewRefId + viewGroup |
| members | unique sparse memberPhone |
| members | unique sparse memberNick |
| authSessions | expiresAt TTL, expireAfterSeconds=0 |

Missing required indexes may be created; duplicates/incompatible indexes block
startup. There is no destructive synchronization or duplicate deletion. Resolve
failures through an operator-reviewed data/index plan with backups; never blindly
drop data/indexes. Performance-only indexes are not auto-created by this gate.

Use one API while uploads are local filesystem state. Mount UPLOAD_ROOT independently
of application artifacts; .tmp/final directories must support hard links, reads,
writes and cleanup on a compatible filesystem. Startup tests capabilities, not
durability. Verify target volume identity, ownership/permissions, capacity, survival
across application replacement and backup/restore. DB backups alone omit images.

## Batch policy

Include one batch scheduler in the recommended production release. API startup does
not require it, but reconciliation/ranking stop without it; cached program counts,
likes/views and ranks may drift after interrupted writes. Batch is not an API
readiness dependency and does not enforce bookings or deliver notifications.

Every minute at seconds 00/20/40 respectively: BATCH_ROLLBACK reconciles active
memberPrograms and clears ineligible ranks; BATCH_TOP_PROGRAMS reconciles engagement
counts and program rank (likes*2 + views); BATCH_TOP_TRAINERS reconciles program
counts and trainer rank (programs*5 + articles*3 + likes*2 + views).
BATCH_ROLLBACK is a reconciliation job name, not a DB rollback operation.
There is no distributed locking/exactly-once guarantee. Avoid duplicate schedulers
and overlapping releases; monitor errors/completion and long-running overlap.
Batch has an internal greeting endpoint, not /health or /ready.

## Exact install, build and start

Run from each repository root with the pinned toolchain. Inject the required build/
runtime values or use a protected env file. Examples are not production credentials.
Build with development dependencies; supervise runtime as an unprivileged identity.

Frontend, after supplying both public URLs:

```sh
yarn install --frozen-lockfile --production=false
yarn typecheck
yarn build
yarn start --hostname 127.0.0.1 --port 3000
```

Backend:

```sh
npm ci --include=dev
node node_modules/typescript/bin/tsc -p apps/gymflow-api/tsconfig.app.json --noEmit --incremental false
node node_modules/typescript/bin/tsc -p apps/gymflow-batch/tsconfig.app.json --noEmit --incremental false
npm run build -- gymflow-api
npm run build -- gymflow-batch
npm run start:prod
# Separate supervised singleton process, with PORT_BATCH=3008:
npm run start:prod:batch
```

Start commands are long-running separate processes; do not wait for API to finish
before starting batch. Keep dist and runtime dependencies, including native Sharp
packages for the target OS/CPU. Frontend needs .next, public, configs and runtime
dependencies for next start. Do not ship Windows native packages to Linux. No
standalone/container packaging or supervisor configuration is added here. Validate
install/build on the actual target OS; dev/watch servers are not production commands.

## Backup and rollback

Before first release, assign owners, recovery objectives, retention/access controls
and a tested restore procedure. Back up MongoDB data/index metadata with managed
snapshots/backups and back up the upload volume. Record a coherent recovery point
for both; quiesce API writes and batch if the chosen platform cannot coordinate
backups. Restore drills must verify application data and referenced image retrieval.
Store configuration and secret version references separately and securely.

For ordinary application failure: remove traffic, stop candidate API/batch cleanly,
restore the previous known-good compatible frontend/backend artifact pair, and
verify environment/public build URLs/schema/index/secret compatibility. Keep Mongo
data and persistent uploads. Start API, require /ready=200, start exactly one
compatible batch, then restore traffic and repeat smoke checks. Do not delete the
volume or restore Mongo merely because an application release failed.

The programRevision backfill is additive/idempotent; application rollback does not
remove it or undo newer business writes. Review intervening schema/data changes
before choosing an older release; no automatic down-migration exists. Restore DB
only for confirmed corruption/destructive data change under an approved recovery
decision with accepted data-loss scope. Restore coordinated DB/uploads to an isolated
target first, verify compatibility/auth-session implications, then explicitly
authorize cutover. Never overwrite live data as a routine rollback shortcut.

## Final operator gates

VERIFIED LOCALLY means only the evidence below. REQUIRES DEPLOYMENT ENVIRONMENT
and POST-DEPLOY CHECK gates remain unchecked.

- [ ] PRE-DEPLOY / REQUIRES DEPLOYMENT ENVIRONMENT: approved artifact/commit pair, owners, rollback pair and Final Release QA sign-off recorded.
- [ ] BUILD / REQUIRES DEPLOYMENT ENVIRONMENT: fresh pinned-toolchain installs/typechecks/builds pass on target OS; lockfiles unchanged; built public URLs match the intended origin.
- [ ] DATABASE / REQUIRES DEPLOYMENT ENVIRONMENT: DB identity/network/permissions/topology and nine index contracts pass API/batch gates; no unreviewed destructive repair.
- [ ] STORAGE / REQUIRES DEPLOYMENT ENVIRONMENT: volume mounted at UPLOAD_ROOT, correct runtime identity/capabilities/capacity; same volume survives application replacement.
- [ ] SECURITY / REQUIRES DEPLOYMENT ENVIRONMENT: HTTPS/domain/routing, exact CORS, independent secrets, preserved cookie attributes, restricted internal ports and no secret/body logging.
- [ ] BACKUP / REQUIRES DEPLOYMENT ENVIRONMENT: coherent DB/upload recovery points and successful restore drill; retention/recovery owners approved.
- [ ] ROLLBACK / REQUIRES DEPLOYMENT ENVIRONMENT: previous compatible artifact pair available; non-destructive rollback rehearsed on an isolated target.
- [ ] STARTUP / REQUIRES DEPLOYMENT ENVIRONMENT: API passes configuration -> Mongo -> storage -> backfill -> readiness; one batch starts on its separate internal port without errors.
- [ ] POST-DEPLOY CHECK: complete and record every smoke row below; only then sign off release QA/cutover.

## Post-deployment smoke plan (not executed here)

Use designated disposable USER/TRAINER accounts and owned records in an authorized
QA window. Never alter unrelated user data. Record commit pair, environment,
browser/device, result and evidence for every row. Failures block sign-off.

| Area | Required observable result |
| --- | --- |
| Home/locales | /, /kr, /ru and localized direct links render; translations and destination survive locale changes. English is unprefixed default. |
| Register/login | /account/join registers USER/TRAINER and logs in; invalid inputs/credentials give useful feedback; ADMIN self-signup rejects. |
| Refresh/logout | Hard refresh/direct private link restores session; production refresh cookie has required attributes; logout stays logged out after refresh. |
| Trainers | /trainer search/sort/pagination and /trainer/detail?trainerId=... work with real data/images. |
| Programs | /program and /program/detail?id=... display/filter correctly; own create/edit via /mypage?category=addProgram or myPrograms works; stale edit conflict preserves persisted state. |
| Images | Permitted upload retrieves at its /uploads URL and survives application replacement; temporary/non-image paths stay blocked. |
| Booking/conflicts | /program/booking?id=... creates an eligible booking; repeat/overlap/full-session attempts reject without duplicates/over-capacity. |
| My Bookings | /mypage?category=myBookings shows own booking/actions; other USER cannot manage it. |
| Trainer transitions | /mypage?category=trainerReservations performs allowed own-reservation transitions and rejects illegal/other-owner actions. |
| Completed review | /mypage/review?reservationId=... accepts an eligible completed-reservation review once; duplicate/ineligible attempts reject. |
| Favorites/follow | /mypage?category=myFavorites and trainer follow/unfollow persist correctly after refresh. |
| Community | /community and /community/detail read correctly; own write/edit flows persist; ownership/revision conflicts enforced. |
| Help | /help search, accordions and links work in every locale. |
| Operational HTTP | /health gives 200 {status:ok}; /ready gives 200 {status:ready}; controlled dependency failure in rehearsal gives readiness 503 without diagnostics. |
| GraphQL exposure | No production Playground/Sandbox; __schema rejects; ordinary operations and __typename succeed. |
| Mobile/browser | Real narrow-screen discovery -> login -> booking -> My Bookings works; usable keyboard controls; no overflow, uncaught console errors, mixed content, broken assets or credential/CORS failures. |

## 17I-D verification evidence

Local verification on October 18, 2026 used Windows, Node 22.13.0, npm 10.9.2 and
Yarn 1.22.22. Builds/tests ran in owned temporary checkouts without loading populated
application env files or accessing existing application databases. All test data
writes were confined to owned disposable fixtures.
Existing servers were not restarted; all isolated start processes were shut down.

| Check | Status and scope |
| --- | --- |
| VERIFIED LOCALLY: backend clean install | npm ci --include=dev --no-audit --no-fund --prefer-offline passed: 934 packages into fresh node_modules, committed manifest/lock unchanged. Existing download cache reused; only development Mongo binary postinstall download disabled. |
| VERIFIED LOCALLY: clean backend compilation | API/batch no-emit TypeScript and npm build commands passed using those freshly installed dependencies. |
| VERIFIED LOCALLY: focused backend checks | 95 production configuration/Mongo/storage/GraphQL/operations unit tests and 10 disposable production integration tests passed. Full 1500+ regressions were not rerun for documentation. |
| VERIFIED LOCALLY: compiled backend startup | Actual npm API/batch production commands passed on owned ephemeral ports with disposable replica-set Mongo/storage. Invalid UPLOAD_ROOT and missing MONGO_PROD exited nonzero. API health/readiness, ordinary GraphQL, disabled introspection/Playground, and Mongo loss -> readiness 503/liveness 200 passed. |
| VERIFIED LOCALLY: refresh cookie headers | Compiled production signup returned the required cookie name/attributes with no Domain. Header inspection over internal HTTP only; public HTTPS/browser cookie persistence remains a deployment check. |
| FRONTEND CLEAN INSTALL: NOT VERIFIED | Disk preflight found about 1.28 GB free versus about 1.07 GB of existing frontend dependencies alone. No safe headroom for a fresh install plus source/download/build output, so no frontend clean-install attempt was made. No user files or unrelated caches were deleted. |
| VERIFIED LOCALLY: frontend build with existing dependencies | Owned fresh source/output checkout reused existing dependencies via junction. Yarn typecheck and production build passed; 78 static pages generated. This is not clean-install evidence. |
| VERIFIED LOCALLY: frontend configuration/start | All 35 existing production URL checks passed. Actual yarn production start served /, /help, /kr/help and /ru/help with HTTP 200 on an owned ephemeral port. Browser chunks retained the build-time URL despite different runtime values. Startup checks only, not browser/Final Release QA. |
| VERIFIED LOCALLY: scope | Only READMEs, env-template comments and this runbook changed. No application source, executable config, scripts, dependency declarations or lockfiles changed. Both protected worktree modifications preserved. |

The clean backend's temporary dependencies were removed after verification to recover
disk headroom; existing working-tree dependencies/caches were preserved. Install/build
artifacts stayed outside both repositories. Backend installs reported inherited
dependency deprecations; the frontend build reported inherited lint, CSS/autoprefixer,
large page-data and parent-lockfile workspace-inference warnings. These were not
auto-fixed. No dependency security audit or broad lint cleanup is claimed.

REQUIRES DEPLOYMENT ENVIRONMENT: fresh frontend installation with adequate disk,
target-OS/native-dependency install/build, real Mongo/Atlas network/permissions,
HTTPS/domain/proxy/CORS/cookie behavior, durable volume replacement checks, singleton
batch observation, coordinated backups/restores and rollback rehearsal.
POST-DEPLOY CHECK: all smoke rows and Final Release QA sign-off remain incomplete.
No cloud resources, domains or certificates were provisioned; nothing was deployed.

Reference behavior: [Next config env](https://nextjs.org/docs/15/pages/api-reference/config/next-config-js/env),
[Yarn frozen install](https://classic.yarnpkg.com/lang/en/docs/cli/install/),
[npm ci](https://docs.npmjs.com/cli/v10/commands/npm-ci/) and
[cookie prefix/attribute rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).
