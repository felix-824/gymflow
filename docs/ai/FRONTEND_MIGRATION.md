# Frontend migration to GymFlow programs

Updated October 8, 2026 (Asia/Seoul).

No frontend repository is present or has been edited. Routes/components below are proposals; the GraphQL changes describe the backend implementation.

1. Inspect the actual frontend repository, router, GraphQL documents, generated types, and validation commands.
2. Replace property/agent operations using [BACKEND_MIGRATION.md](BACKEND_MIGRATION.md). Regenerate client types together; the new API has no legacy aliases.
3. Replace property title with programName. Render category, price in KRW/session, duration in minutes, capacity, type, location, images, and trainer information.
4. Replace area/rooms/beds/rent/barter filters with program type/category/location/price filters. Use only the backend's program sort allowlist.
5. Keep getFavorites/getVisited operation names but select Program fields from their list results.
6. Replace AGENT with TRAINER and memberProperties with memberPrograms. Signup offers USER/TRAINER only. Self-update must use MemberSelfUpdate without _id, memberType, or memberStatus.
7. Trainer management supports ACTIVE/PAUSED transitions and terminal soft deletion. Handle optimistic-update conflicts by refreshing.
8. Replace commentGroup/commentRefId with articleId. Do not expose program reviews or booking controls as working features yet.
9. Upload program images using target `program`; other valid targets are `member` and `article`.
10. Test public/private visibility, expired/blocked authentication, ownership denial, offline program validation, favorites/history, empty results, and deleted programs against a disposable backend.

Illustrative routes: /programs, /programs/[id], /trainers, /trainers/[id], /trainer/programs, /favorites. These are not discovered frontend files.

Coordinate rollout with a fresh backend database. Obtain new authentication sessions for that environment. No frontend tests or deployment were performed in this workspace.
