# Firebase Hosting and persistent Node API

The Firebase deployment serves a static React application from Hosting and
rewrites `/api/**` to a dedicated Cloud Run Node service. It shares the research
engine, provider adapters, reports and route validation with the Sites build.
Build-time aliases replace only identity, storage and runtime environment access.
The existing Sites/D1 deployment remains supported.

## Identity and storage

Every personal API request carries a Firebase ID token in the Authorization
header. The Admin SDK validates its signature, audience, issuer and expiry.
Caller-supplied Sites identity headers are ignored. Firebase anonymous accounts
provide a persistent browser-owned private workspace; optional account linking
must preserve its UID to retain history. Browser storage deletion can lose an
anonymous sign-in, so export important work or link an account before clearing it.

Records are partitioned by a hash of the verified Firebase UID in the named
Firestore database. The browser has no direct database access. The runtime uses
its assigned service account and application-default credentials; no private
service-account key is shipped in source or the browser. Firestore rules must
refuse direct client access. API ownership checks remain mandatory.

Run results and memory are compressed into versioned, bounded JSON records.
Completed result and memory writes share one transaction. Small completion-index
documents support bounded recent-history reads and paginated full export without
requiring a composite index. Saved stock identity comes from an owned research
record rather than client-supplied company metadata.

Erasure blocks concurrent commits and removes personal subcollections. A small
technical erasure marker prevents requests begun before erasure from restoring
results. Deleting research increments the memory generation: an in-flight run
cannot restore recalled context from the cleared generation. Old archive cleanup
is generation-scoped, so it cannot remove a newly created generation by accident.

## Connected research queue

Sample research returns immediately. Connected research uses a persistent Cloud
Tasks job because Hosting rewrites time out before long provider requests can
finish. A successful POST returns 202 with an ID and poll URL. Polling returns 202
while queued/running, 200 for a completed research record, or 422 for a failed job.
`GET /api/jobs` restores pending account jobs after a reload.

Only a signed Google OIDC token for the configured task service account and exact
Cloud Run audience can invoke `/_internal/research-jobs`. Task-name headers are
not authentication. The job loads the profile from the account's immutable run
record; it does not accept arbitrary provider URLs, SQL or profile replacements.

A queued job may wait up to thirty minutes. Once claimed, execution is bounded to
fifteen minutes, matching its dispatch deadline and active lease. Late completion
can only release its own lock. Duplicate deliveries never replay a potentially
billed model request. The configured queue currently makes one delivery attempt;
an interrupted or ambiguous execution becomes an explicit failure requiring user
review and a new request. This is persistent dispatch and result storage, not a
claim of resumable inference or automatic recovery of a paid provider operation.

Both account and shared live-provider budgets limit requests. The queue also
limits dispatch concurrency. These controls reduce anonymous-account abuse;
production monitoring, spend limits and additional abuse controls remain needed.

## Server configuration

- `FIREBASE_PROJECT_ID`: the Firebase/GCP project used by ID tokens.
- `FIRESTORE_DATABASE_ID`: the dedicated named database, such as `thesis-research`.
- `PUBLIC_ORIGINS`: the allowed Hosting origins, separated by commas.
- `CLOUD_TASKS_LOCATION` and `CLOUD_TASKS_QUEUE`: the dedicated queue location/name.
- `CLOUD_RUN_SERVICE_URL`: exact service origin used as the OIDC audience.
- `TASKS_INVOKER_SERVICE_ACCOUNT`: the single approved task identity.
- Provider credentials: server environment/Secret Manager only.

The Cloud Run runtime needs access only to its named Firestore database, queue,
approved task-service-account delegation and designated provider-gateway secret.
Provisioning/deployment is separate from the application build. The gateway must
expose only the narrow authenticated sponsor operations required by the app.

The recorded public application run exercised Cloud Tasks, the authenticated
gateway, Zetaris, Nightshift and H-MEM to completion. Hosted API tests separately
verified real Firebase UID isolation and workspace erasure. These are execution
checks, not an external security audit or an availability SLA.

Build the API with `node scripts/build-api.mjs`. It produces
`dist/api/server.mjs`. `Dockerfile.api` uses Node 24 and runs a stateless Node
process; all personal persistence is in Firestore, not local SQLite or a container
filesystem. Firebase Hosting serves the web build separately.

## Financial scope

The base-currency schema supports USD, INR, CNY, AED and HKD. Without aligned FX history, a security in a different listing currency remains
watch-only for the chosen base-currency mandate. Passing local-currency volatility
and drawdown checks does not establish base-currency suitability. The app does
not pretend that changing a reporting label converted the price series.

Public connected demonstration data is synthetic and remains visibly labeled.
Actual personal-use price data and its numerical output must stay in the private
research namespace and private evidence. Hosting availability does not create
market-data redistribution rights or verify the truth of a model interpretation.

## Verification boundaries

Unit tests cover token boundaries, request-context isolation, serialization,
repository owner isolation, idempotency, server-owned saved identity, erasure,
memory invalidation and lease races. Their Firestore contract fake checks the
transaction read-before-write rule but cannot prove remote IAM, latency or
service availability. Deployed multi-account API and browser tests must establish
those boundaries against the actual named database and Hosting rewrite.
