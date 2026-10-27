# Security

Do not put credentials in public issues, source, browser bundles, screenshots or
demo narration. Sponsor keys remain in server environment variables or the
operator's sponsor services. NVIDIA provider keys belong in Nightshift.

## Public Firebase boundary

The public Firebase Hosting application calls a Cloud Run Node API. Every
personal operation requires a Firebase ID token whose signature, issuer,
audience and expiry are checked by the Admin SDK. Caller-supplied
`oai-authenticated-user-*` headers are ignored. Anonymous Firebase accounts own
real private workspaces; losing an unlinked browser sign-in can lose access to
that workspace.

The server partitions Firestore data by the verified UID and derives saved stock
identity from an owned run. Client Firestore rules refuse direct access. Cloud
Run uses a dedicated runtime service account and a dedicated named database;
private service-account key files are not distributed. Same-origin and request
size checks supplement token authorization.

Cloud Tasks invokes its internal endpoint only with a signed Google OIDC token
for the configured service account and exact service audience. Forged task-name
headers do not authenticate. Queued profiles are loaded from immutable owned run
state. Shared live-provider rate limits and queue concurrency bound inference
pressure; anonymous-account abuse still needs monitoring and spend controls.

## Alternate Sites boundary

The alternate Sites deployment uses platform identity and D1. Never deploy its
raw Worker publicly while trusting arbitrary Sites identity headers. Synthetic
local headers are for loopback tests only. The public Node build uses separate
Firebase identity and Firestore aliases, rather than carrying that trust model
onto Cloud Run.

## Data and provider boundary

All source passages and model outputs are untrusted. Neither can change numeric
risk limits, ownership, SQL, provider URLs or credentials. Schema and citation
membership checks do not certify financial truth. Source freshness and
inconsistency failures keep a candidate out of the qualified set. Different
listing currencies remain watch-only without aligned FX history.

The public provider gateway permits only required model operations and approved
synthetic research-view queries. Its secret is separate from the underlying
provider credentials. The actual personal-data namespace is excluded. Temporary
tunnel reachability is an availability dependency, not a security guarantee.

Private personal-use vendor prices and derived numerical market results must
stay in ignored private storage and the private namespace. Public source/evidence
may contain synthetic fixtures and sanitized operational metadata. A successful
API request does not create data display or redistribution rights.

Result and memory commits are atomic. Account erasure and memory generations
prevent old in-flight context from restoring deleted personal content. Full
exports paginate reads and apply stream backpressure; client disconnects cancel
the response source. Secrets and raw provider error bodies are not returned to
clients.

## Assurance boundary

Automated tests and deployed UID-isolation checks demonstrate specific controls;
they are not a penetration-test certification. Commercial release still requires
external review, dependency/security maintenance, monitoring, recovery drills,
retention and deletion policy, abuse/load testing, licensed data use and review
of investment-research obligations in the intended jurisdictions.
