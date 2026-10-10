## Frontend migration — October 10, 2026 (Asia/Seoul)

Implemented the approved nestar-next → gymflow-next frontend migration in the sibling gymflow-next repository. Changes remain uncommitted. This section supersedes earlier statements that the frontend has not been inspected or migrated.

### Implemented

- Preserved Next.js 14 Pages Router, React 18, Apollo Client/reactive variables, MUI, SCSS, next-i18next, layout HOCs and the existing query/onCompleted/local-state and async handler patterns. Existing Nestar counterparts were inspected before adaptation. No dependency versions, lockfiles or environment values were changed.
- Added exact Program enums, input/update/inquiry interfaces and whitelisted form payloads. Migrated Property/Agent GraphQL operations, nested Member counters, cards and consumers to Program/TRAINER. Removed obsolete domain types and unsupported program/trainer reviews.
- Public routes are /program, /program/detail?id=..., /trainer and /trainer/detail?trainerId=.... Catalog filters use supported type/category/location/price/name fields; URL input is parsed defensively, sort fields are bounded, pagination resets on filter changes, and like refetches preserve context. Home sections use likes/views/rank.
- Restored authentication from Member mutation results and JWT sub → checkAuth → getMember. Deduplicated restoration; delayed cabinet/admin guards; reset invalid/expired/blocked sessions and private Apollo cache; retained sessions on ordinary ownership/role denial. Applied current server roles and protected against stale restoration replacing a different session. Signup exposes USER/TRAINER; self-profile updates use MemberSelfUpdate.
- Trainer management remains in /mypage (myPrograms/addProgram, programId). ACTIVE/PAUSED lists, pause/resume, terminal soft-delete, edit context across navigation and paused-program reload via getTrainerPrograms are implemented. Forms validate free/integer pricing, positive duration/capacity, PT capacity 1, ONLINE pairing, bounded text, offline address and required images; pending submissions are locked; conflict responses refetch latest values for manual review.
- Program multipart uploads use target program and dynamic operations/map entries for the selected file count, preserving the five-image limit. GraphQL upload failures retain current images. Member/article upload paths were preserved with response checks. Favorites/history render Program cards and adjust invalid pages; community comments use articleId.
- Admin programs moved to /_admin/programs, with ACTIVE/PAUSED/DELETE visibility, terminal deletion and hard-delete offered only for DELETE. User roles/counters use TRAINER/memberPrograms. GymFlow branding, metadata, navigation, marketing copy and en/kr/ru translations were updated; existing palette/typography and folder architecture remain.
- Added dependency-free GraphQL/schema checking and migration unit/DOM checks using installed packages, plus a disposable integration runner using the sibling backend's existing development dependencies.

### Validation executed

| Check | Result |
| --- | --- |
| Yarn no-emit TypeScript after implementation phases | PASS; final exit 0. The pre-existing Teditor createBoardArticle typo was fixed during migration. |
| yarn check:graphql | PASS: 40 frontend GraphQL documents, including gql() and inline multipart documents, validated against http://localhost:3007/graphql. Schema introspection only. |
| yarn test:migration | PASS: 30 URL/form/payload/auth/DOM checks, including zero-price display, malformed input, restore deduplication, expired/blocked/network sessions, changed role, stale restoration, PAUSED edit context, ONLINE/PT transitions, failed upload retention, conflict refetch and duplicate-submit locking. |
| yarn test:integration | PASS: 9 groups against an owned disposable MongoDB/Nest server using actual frontend documents. Covers signup/login/profile, numeric/domain validation, USER/TRAINER/ADMIN guards, ownership, public filters/sorting/pagination/trainers, likes/favorites/history, PAUSED editing/resume, article comments/likes/follow, actual 1/3/5-file and member/article multipart uploads, admin terminal soft/hard-delete, changed roles, blocked accounts and expired tokens. |
| yarn build | PASS: all 72 localized/static pages generated; new Program/Trainer/admin routes present. |
| yarn lint --no-cache (default Pages coverage; also run by build) | PASS with existing image/link/hook warnings. |
| yarn lint --no-cache --dir libs --dir apollo --quiet | FAIL: four pre-existing errors in unchanged libs/components/common/ScrollControls.tsx (three missing display names, one ReactDOM.render deprecation). No remaining errors in migrated files. Do not report repository-wide lint as passing. |
| Runtime legacy API/domain-field scan and literal static asset paths | PASS: no old Property/Agent API names, AGENT/SOLD or unsupported real-estate payload fields; literal asset references resolve. Existing asset filenames may retain historical names. |
| git diff --check | PASS. The user's pre-existing AGENTS.md change was preserved. |
| Desktop/mobile visual and real-browser navigation/session checks | NOT VERIFIED: browser inventory was empty, in-app browser unavailable, native Computer Use pipe unavailable. DOM form checks are not a visual-browser verification. |

The integration runner never imports AppModule, DatabaseModule or ScheduleModule and never reads an application database URI. It starts its own loopback MongoDB, initializes indexes, uses an isolated Nest module and test JWT key, writes uploads under an owned OS temporary directory, then closes the application/server and removes only that directory. It reuses the cached MongoDB 8.2.6 binary at gymflow/.tmp/mongodb-binaries; automatic downloads are disabled. No mutation or upload was sent to the running application backend.

Existing mobile placeholders remain within the approved mobile scope. Booking, reservations, schedules, reviews, payments and notification delivery are still deferred. No backend contract extension, application-data migration, deployment or commit was performed.

Frontend commands: yarn tsc --noEmit --incremental false; yarn check:graphql; yarn test:migration; yarn test:integration; yarn lint --no-cache; yarn build.

---

# Completed tasks and validation evidence

## Continuation completed - October 8, 2026 (Asia/Seoul)

Reviewed the existing uncommitted migration and prior validation before continuing. The completed domain implementation was retained. This section supersedes the earlier validation counts and infrastructure limits below.

### Remaining work completed

- Corrected database ID annotations to Mongoose `Types.ObjectId` across shared consumers, typed identifier conversion and aggregation results, narrowed JWT claims and duplicate-key errors, and typed the shared GraphQL authentication context.
- Kept authentication based on the current database account. Public guards and the auth-member decorator now use the same GraphQL context as write guards.
- Typed partial dependency mocks and query fixtures without weakening ESLint's intended type-aware rules. Formatted affected TypeScript files and removed unused declarations in those files.
- Corrected single uploads to await the Upload scalar promise without asking ValidationPipe to instantiate Promise. Both upload paths use stream pipelines and report stream errors. Verified an actual authenticated multipart program image and removed only the UUID image created by that test.
- Added pinned development-only `mongodb-memory-server@11.3.0` and its lockfile entries, plus `npm run test:integration`. Runtime dependency versions were not upgraded.
- Added disposable MongoDB 8.2.6 integration covering HTTP GraphQL authorization/input validation, current-role and blocked-account enforcement, ownership, lifecycle concurrency, persisted deletion timestamps, indexes/group identity, repeated views, discovery and saved-list totals, article counters, hard-delete child cleanup, repeatable cache/rank reconciliation, and reusable signup/login/password/engagement/follow behavior.
- Extended the generated GraphQL contract checks to verify every approved program enum value.

### Final validation

| Check | Result |
| --- | --- |
| API and batch no-emit TypeScript | PASS, each exit 0 |
| Nest API and batch builds | PASS, each exit 0 |
| Offline Jest regressions | PASS: 5 suites, 60 tests |
| Disposable MongoDB integration | PASS: 1 suite, 10 tests |
| API and batch isolated greeting smoke | PASS: 1 test each |
| Changed TypeScript non-fixing lint | PASS: 0 errors, 0 warnings |
| Repository-wide non-fixing lint | FAIL: 208 errors, 5 warnings, all in untouched files |
| Runtime legacy-symbol scan | No property/agent/domain-field references found |
| Git whitespace diff check | PASS |

The repository-wide lint debt remains in untouched app/database/module bootstrap files, the logging interceptor, socket files, common enum, and Follow/Notice schemas. It is separate from the migrated files. Do not report repository-wide lint as passing.

The integration suite never imports application DatabaseModule or ScheduleModule, never reads an application connection string, and has no external-database fallback. It creates a unique database on its own loopback mongod, initializes schema indexes, invokes batch methods directly, closes the Nest application, and stops the owned server. The binary cache lives in ignored `.tmp/mongodb-binaries`. Run:

```powershell
npm test -- --runInBand
npm run test:integration
node node_modules/jest/bin/jest.js --config apps/gymflow-api/test/jest-e2e.json --runInBand
node node_modules/jest/bin/jest.js --config apps/gymflow-batch/test/jest-e2e.json --runInBand
```

Same-process concurrent lifecycle/view requests were verified. Multi-process concurrency, distributed scheduler locking, transaction guarantees, and release-specific startup against a provisioned fresh database were not claimed. Cross-document cache writes remain nontransactional as approved; batch reconciliation was verified. Reservations, schedules, reviews, booking enforcement, and notification delivery remain deferred.

Changes remain uncommitted. No existing application database, environment value, legacy data, staging area, or deployment was changed.

## Program migration ? October 8, 2026 (Asia/Seoul)

Implemented against baseline commit `0ba6531`; changes are uncommitted. The working tree was clean before implementation. This section supersedes the historical naming-only state below.

### Implemented

- Replaced property feature/schema/DTOs/enums and agent directory/role with Program and TRAINER contracts.
- Added ER category/duration/capacity, exact approved enums, integer/session validation, delivery/location rules, and optional address/description semantics.
- Added trainer ownership, ACTIVE/PAUSED/DELETE lifecycle, persisted deletion timestamps, optimistic version/status checks, active-program counter deltas, and public owner visibility.
- Repaired favorites/history routing and aggregation; migrated engagement groups and uniqueness; preserved member/article features.
- Restricted signup roles and self-update fields, hashed password updates, and reloaded active accounts/current roles during JWT verification.
- Changed comments to articleId and authored active-comment counters; updated notification program/reservation references and ER nullability.
- Updated batch model registration, schedules, program/trainer formulas, eligibility, and count/rank reconciliation.
- Added validated program upload targets and retryable child cleanup before hard deletion.
- Repaired ESLint imports using the installed parser/plugin while preserving intended type-checked rules; no dependency or lockfile updates.
- Added offline validation/lifecycle/auth/engagement/comment/batch/schema/module regression tests. Isolated old greeting tests from DatabaseModule and ScheduleModule.
- Updated repository instructions, skill catalog, and AI handoff docs for the approved program scope.

### Validation executed

| Check | Result |
| --- | --- |
| API no-emit TypeScript | PASS, exit 0 |
| Batch no-emit TypeScript | PASS, exit 0 |
| Nest API build | PASS, exit 0 |
| Nest batch build | PASS, exit 0 |
| Jest regression suite | PASS: 5 suites, 59 tests |
| API isolated greeting smoke | PASS: 1 test |
| Batch isolated greeting smoke | PASS: 1 test |
| GraphQL schema and Nest feature dependency graph | PASS within regression suite; disconnected Mongoose connection |
| Runtime legacy-symbol scan | No property/agent/domain-field references found in API/batch runtime source |
| Non-fixing ESLint | Loads successfully; FAIL: 712 errors, 101 warnings |

Lint breakdown: 453 errors are in untouched files; 259 are in changed files, including 182 in test mocks and 77 in production files. These are not all pre-existing findings. Main categories are formatting in untouched files, unsafe typing/member access in legacy and changed code, test mock typing, unused declarations, and require-await. Do not report lint as passing. The previous missing-typescript-eslint startup blocker is fixed; the intended type-aware checks were retained rather than disabled. Changed TypeScript files were formatted; unrelated files were not reformatted.

Commands:

```powershell
node node_modules/typescript/bin/tsc -p apps/gymflow-api/tsconfig.app.json --noEmit --incremental false
node node_modules/typescript/bin/tsc -p apps/gymflow-batch/tsconfig.app.json --noEmit --incremental false
node node_modules/@nestjs/cli/bin/nest.js build gymflow-api
node node_modules/@nestjs/cli/bin/nest.js build gymflow-batch
node node_modules/jest/bin/jest.js --runInBand
node node_modules/jest/bin/jest.js --config apps/gymflow-api/test/jest-e2e.json --runInBand
node node_modules/jest/bin/jest.js --config apps/gymflow-batch/test/jest-e2e.json --runInBand
node node_modules/eslint/bin/eslint.js --config eslint.config.mjs "apps/**/*.ts" --no-fix
```

### Limits and deferred work

No live MongoDB connection, index installation, aggregation integration test, or multi-process concurrency test was run. Tests use schema validation, disconnected module compilation, and service/model fixtures. No MongoDB server or Docker executable was available on PATH. Existing application databases were never used as a fallback.

Cross-document writes remain nontransactional as approved. Batch reconciles program engagement/active-program counters and rankings; comment/member/article counter recovery after partial storage failures remains separate work. Deployment should use one scheduler instance until distributed locking exists.

Reservations, schedules, reviews, booking enforcement, notification delivery, frontend changes, database provisioning, environment-value changes, staging, commits, and deployment were not performed.

## Historical naming-only handoff

The following text is retained as historical evidence. Its status statements apply to the earlier naming-only refactor, not to the program implementation above.

# Completed tasks and validation evidence

Snapshot: October 8, 2026 (Asia/Seoul).
**Status vocabulary:** **Completed** = implemented or verified in this session; **Confirmed direction** = user-selected product intent; **Proposed** = future design/work; **Blocked** = known blocker; **Not verified** = unavailable evidence or an unrun check.

## Current repository state

**Completed:** the assistant inspected the two-app backend, planned a broader migration with user-selected product preferences, implemented the approved naming-only refactor, and presented a read-only diff.

Before this documentation task, `git status --short` was empty and HEAD was `679d0d5` (“fix: Modify project name into petoria”). The code at that snapshot uses GymFlow. The assistant did not create that commit. The six documentation files introduced by this task are new working-tree changes; the earlier clean-state observation does not mean these documents are committed.

The user's pre-existing `AGENTS.md` edit added the Project Goal heading. It was preserved and is not counted as assistant work.

## Completed rename inventory

**Completed:** 86 app files moved; 77 retained their contents and nine had naming/test edits. Four root files had content edits. The rename content diff totaled +48 / -37 lines, excluding the user's AGENTS.md edit and excluding these new documents. These counts are session audit evidence, not a claim that 86 new implementations were written.

| Change | Files/area | Result |
| --- | --- | --- |
| API directory/project | apps/nestar-api → apps/gymflow-api | All 77 API app files moved; five edited internally |
| Batch directory/project | apps/nestar-batch → apps/gymflow-batch | All nine batch app files moved; four edited internally |
| Root metadata and scripts | package.json | Package name and five changed lines overall; existing script names retained |
| Lockfile metadata | package-lock.json | Two root package-name replacements; dependency graph unchanged |
| Nest CLI project configuration | nest-cli.json | Project keys, roots, source roots, TypeScript config paths |
| Project documentation | README.md | GymFlow overview and API/batch commands |

### Nine internally edited app files

Paths below are relative to the repository root.

| File | Content change | Added / removed |
| --- | --- | --- |
| apps/gymflow-api/src/app.service.ts | GymFlow API welcome text | +1 / -1 |
| apps/gymflow-api/src/components/auth/guards/auth.guard.ts | Absolute import path | +1 / -1 |
| apps/gymflow-api/src/components/auth/guards/roles.guard.ts | Absolute import path | +1 / -1 |
| apps/gymflow-api/test/app.e2e-spec.ts | Suite branding and greeting expectation | +2 / -2 |
| apps/gymflow-api/tsconfig.app.json | Output directory | +1 / -1 |
| apps/gymflow-batch/src/batch.module.ts | Two schema imports | +2 / -2 |
| apps/gymflow-batch/src/batch.service.ts | Four imports and batch welcome text | +5 / -5 |
| apps/gymflow-batch/test/app.e2e-spec.ts | Existing BatchModule reference, suite branding, greeting expectation | +4 / -4 |
| apps/gymflow-batch/tsconfig.app.json | Output directory | +1 / -1 |

Root-file totals: README +12/-1, nest-cli.json +11/-11, package-lock.json +2/-2, package.json +5/-5.

### Preserved behavior

**Completed:** all real estate modules, GraphQL names/fields/enums, MongoDB collections/schemas/indexes, roles, authentication behavior, ports, schedules, batch constants, upload handling, and dependency versions were preserved. There was no gym-domain implementation or data migration.

The assistant preserved the .env bytes during its rename. Later user configuration edits, live database state, and deployment changes are **Not verified**; no secret values are recorded here.

## Validation status

These results were obtained after the naming refactor earlier in this session. They were not rerun for this documentation-only task.

| Check | Status | Observed result |
| --- | --- | --- |
| Batch no-emit TypeScript check | Completed | Passed, exit 0 |
| API no-emit TypeScript check | Blocked | Same three pre-existing compiler diagnostics, exit 2 |
| ESLint with auto-fixes disabled | Blocked | Configuration load failed: missing typescript-eslint package, exit 2 |
| 86-file move/content audit | Completed | 77 unchanged internally; nine matched approved substitutions |
| Package/lockfile/Nest config comparison | Completed | Naming substitutions only |
| App roots/config paths/absolute imports | Completed | Resolved after rename |
| Legacy reference scan | Completed | No Nestar references in scanned source/configuration; generated output, dependencies, uploads, .git, and .env excluded |
| Git whitespace diff check | Completed | No whitespace errors reported |
| End-to-end and database-connected tests | Not verified | Not run |
| Live app startup, deployment, frontend | Not verified | Not run / no frontend source inspected |

Known API diagnostics:

1. `components/like/like.service.ts`: imported `lookupFavorite` is not exported from `libs/config.ts`.
2. `components/view/view.service.ts`: imported `lookupVisit` is not exported from `libs/config.ts`.
3. `components/property/property.resolver.ts`: `getFavorites` sends `OrdinaryInquiry` to `getProperties`, which expects `PropertiesInquiry` with `search`.

Commands used:

```powershell
node node_modules/eslint/bin/eslint.js --config eslint.config.mjs "apps/**/*.ts" --no-fix
node node_modules/typescript/bin/tsc -p apps/gymflow-api/tsconfig.app.json --noEmit --incremental false
node node_modules/typescript/bin/tsc -p apps/gymflow-batch/tsconfig.app.json --noEmit --incremental false
```

The existing npm lint script includes auto-fixing; it was not used for the read-only lint check. The blocker fixes were deliberately excluded from the naming refactor.

## Not completed

- **Confirmed direction:** independent gyms, discovery plus core operations, offline payments, and a future fresh start.
- **Proposed:** new gym models/contracts, gym-scoped roles, shared libraries, membership/booking/attendance behavior, and revised jobs.
- **Not verified:** frontend paths/components, future GraphQL signatures, live data, and deployment infrastructure.

Related: [Backend migration](BACKEND_MIGRATION.md), [Decisions](DECISIONS.md), [Next steps](NEXT_STEPS.md).


## Home glass surfaces and subtle motion - October 11, 2026 (Asia/Seoul)

Implemented the approved Home navbar/header-search refinement in the sibling gymflow-next frontend. Applied the swiftui-liquid-glass skill's visual principles as SCSS for the existing Next.js website, rather than native SwiftUI APIs, and used the already installed Framer Motion dependency following framer-motion-animator.

### Implemented

- Home-only navbar treatment uses router.pathname === '/', retaining the full-width fixed layout, 87 px height, existing logo size, links and account/language controls. Added a dark translucent surface with 16 px blur, subtle border and shadow, and a denser surface after the existing 50 px scroll threshold. Added an opaque fallback when backdrop-filter is unsupported.
- Header-search retains its layout and the Location, Program Type, Category and coral Search controls. Added a 20 px blurred glass panel, inset highlights, readable light dropdown surfaces and a matching menu surface. No logo hover background, glow or shadow was added. Fiber assets/animation and mobile feature coverage remain unchanged.
- Added SSR-visible, post-mount navbar content entrance (opacity and -6 px to 0, 320 ms), search entrance (opacity only, 400 ms), navigation underline transitions and Search hover/press gestures (y -1 px / scale 0.98, spring stiffness 350, damping 28). The fixed navbar root is not transformed. Reduced-motion disables entrance/gesture animations and dropdown transitions; normal dropdown enter/exit durations are 140/100 ms.
- Moved the existing navbar scroll listener into an effect with passive registration and cleanup to avoid accumulating listeners on rerenders. Preserved the original threshold and state behavior.
- Search handlers, multi-select values, query input routing, immediate close after selection, MUI focus/portal behavior and disableScrollLock remain intact. Full catalog filters and non-Home navbar use their original non-motion components. No GraphQL, auth, backend, public interface, package manifest or lockfile changes.

### Validation

- Yarn no-emit TypeScript passed after both phases and after the SSR entrance adjustment.
- Targeted non-fixing lint passed for Top.tsx and program/Filter.tsx. Top retains 20 pre-existing link/image warnings; Filter has no lint findings. Repository-wide lint is not claimed.
- Full desktop SCSS compilation and git diff --check passed.
- yarn test:migration passed all 30 existing migration unit/DOM checks.
- Temporary DOM checks with real MUI and Framer Motion passed in normal and reduced-motion modes: entrance execution versus reduced-motion visibility; all three dropdowns; multiple location selection; immediate close; unchanged body overflow/padding; Escape, backdrop dismissal and keyboard opening; exact /program query input; original full catalog filter; guest/member navigation, scroll threshold and profile/logout menu; non-Home navbar scope. Language menu locale storage/current-route navigation was also verified. Router, authentication/member state and two icon exports were mocked; no application-backend writes were performed. JSDOM emits an expected anchorEl geometry warning because it does not implement layout. The temporary harness is outside the repository.
- Final yarn build passed and generated all 72 pages. Existing page lint warnings and the outdated Browserslist database notice remain.
- Real-browser visual/geometry checks were NOT VERIFIED: available app/browser inventory was empty. DOM checks do not establish navbar pixel-coordinate stability, glass rendering/contrast over actual images, long-translation layout, mobile appearance or low-end-device animation performance.

Frontend commits: 2035bb9 (feat: refine home glass surfaces), ea36a9a (feat: add subtle home animations). No deployment or GitHub push was performed.

## Home Trend Programs card refinement - October 11, 2026 (Asia/Seoul)

Implemented the approved trend-programs-only design update in the sibling gymflow-next frontend, applying the shadcn-ui skill's Card, Badge and Button principles through the existing MUI/SCSS stack. No shadcn/Tailwind installation or dependency changes.

### Implemented

- Replaced duplicate mobile/desktop card markup with one responsive Program card: white surface, warm neutral palette, coral accents, 20 px corners, subtle border/shadow and a 190 px cropped image. Category badge and a separate 40 px like button sit over the image.
- Added translated training type/category/location, two-line title and optional two-line description, duration/capacity metadata, formatted KRW/session pricing (including zero), and noninteractive view/like counters. ONLINE uses the translated online location.
- Image/title use keyboard-accessible Next.js detail links with the existing /program/detail?id=... route. Like keeps the existing handler and adds translated accessible naming, aria-pressed and a visible focus outline. Missing/failed images use a neutral fitness icon; changing the image URL can recover from failure.
- Preserved 300 px desktop cards and 98% mobile slides. Shared scoped SCSS replaces old fixed-height trend rules and unused options selectors, allowing content-driven section/carousel height and equal-height slides. Hover lifts by 3 px only for hover-capable devices without reduced-motion preference.
- Converted existing Swiper previous/next controls into labeled keyboard-focusable MUI buttons without changing the navigation selectors. Localized the trend heading, subtitle and empty state in en/kr/ru.
- Apollo documents, query/mutation patterns, programLikes/DESC sorting, same-input like refetch, interfaces and other sections/pages remain unchanged. No property-specific elements remain in the modified trend components/styles; unrelated legacy banners/assets were outside the approved scope.

### Validation and limitations

- Baseline and post-change yarn tsc --noEmit --incremental false are BLOCKED by the pre-existing untracked skills/shadcn-ui/examples files: missing shadcn aliases/packages and implicit-any diagnostics. Those user files and tsconfig.json were not changed.
- An application-only TypeScript check passed using the existing tsconfig with skill directories excluded in memory; no configuration was written.
- Targeted non-fixing lint passed for TrendProgramCard.tsx and TrendPrograms.tsx with no warnings/errors.
- Full desktop and mobile SCSS compilation passed; all new en/kr/ru translation keys and UTF-8 text were checked. git diff --check and staged diff checks passed.
- yarn test:migration passed all 30 existing migration unit/DOM checks.
- Temporary JSDOM checks with real React/MUI/Swiper and i18next passed: three locales, readable enum labels/units, zero and maximum valid price, detail hrefs, separate like control, broken/missing images and image replacement, blank description, ONLINE location, guest like rejection, user like/unlike, same-input refetch and updated counts/state, real Swiper next/previous behavior with emulated dimensions, mobile branch and empty results. Router link rendering, Apollo/member state and alerts were mocked. No application-backend mutations were made.
- yarn build was attempted and is BLOCKED at the same pre-existing skills/shadcn-ui/examples/auth-layout.tsx missing @/components/ui/button import. Existing unrelated page lint warnings also remain. A successful production build is not claimed.
- Real-browser visual/layout, touch interaction, keyboard activation in a browser and screen-reader checks were NOT VERIFIED: available app/browser inventory was empty. DOM checks and SCSS compilation do not establish pixel-level rendering, actual line clipping or visual reduced-motion behavior.
- Temporary checks live outside the repository. User-added skill files and skills-lock.json changes were preserved and excluded from the commit.

Frontend commit: a78c910 (feat: refine trend program cards). No GitHub push or deployment.
