# Firebase deployment

Public application: **https://thesis-investing.web.app**.

The static React build is served by Firebase Hosting. `/api/**` is rewritten to the dedicated `thesis-api` Cloud Run service in `us-central1`. Firebase ID tokens identify private guest workspaces. The API stores records in the named `thesis-research` Firestore database, with a runtime service account restricted to that database through an IAM condition. Client database access is denied; the browser never receives service-account credentials.

The existing billed Google Cloud project hosts these separately named resources because the operator account's new-project and billing-link quotas were full. Existing Hosting sites, databases and applications were not replaced. The public hostname comes from the new Hosting site ID, independent of the parent project ID.

## Repeated clean deployment

Use Node 24 LTS, an authorized gcloud login, the repository lockfile and an ignored private Cloud Run environment file:

```sh
npm ci
THESIS_CLOUD_ENV=/absolute/private/path/cloudrun.env.yaml npm run deploy:firebase
```

The script typechecks, runs automated tests, builds the client, submits a clean Linux container build with `npm ci`, deploys the API, releases Hosting, and runs isolated hosted API tests. The deployment token remains in memory. The Hosting REST uploader sends only the web build directory and rejects debug maps and private file types.

`cloudbuild.api.yaml`, `Dockerfile.api`, `firebase.json`, `scripts/build-api.mjs` and `scripts/deploy-firebase-hosting.mjs` are the deployment sources. See `firebase-backend.md` for the queue, authentication and persistence contract. The `.gcloudignore` excludes private environment files, local state, work files and media from the container build context.

## Required resources and configuration

Provision a Firebase web app, Hosting site, named Firestore database, Artifact Registry repository, Cloud Run service, Cloud Tasks queue and dedicated runtime/task-delivery service accounts. The runtime needs database-scoped `datastore.user`, task enqueue access, permission to act as the task-delivery account, and access only to its gateway and account-encryption secrets. Task delivery uses a signed Google OIDC token; forged Cloud Tasks headers do not authorize execution.

The public Firebase client configuration is intentionally public and uses a dedicated key restricted to Authentication and Secure Token APIs plus Thesis hostnames and the configured Firebase authentication-handler domain. It cannot authorize database reads. For another deployment, replace `web/firebase-config.json`, the Hosting site ID and the resource IDs before building. Add its hostnames to Firebase Authentication's authorized domains.

The environment file contains `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID`, `PUBLIC_ORIGINS`, `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_QUEUE`, `CLOUD_RUN_SERVICE_URL`, `TASKS_INVOKER_SERVICE_ACCOUNT` and the non-secret provider URLs/model/view settings. Actual gateway credentials and THESIS_SETTINGS_KEY are injected through Secret Manager, with no value in source or command arguments. The account encryption key is 32 random bytes encoded as base64url and is stored as thesis-settings-master:1. Preserve this key when redeploying so existing encrypted account credentials remain readable.

## Connected local services

Zetaris and Nightshift run on the operator's machine. `scripts/provider-gateway.mjs` listens only on loopback and exposes a narrow authenticated bridge through an HTTPS tunnel. Its legacy SQL allowlist permits only the explicitly synthetic archived verification view. The v2 observation endpoints derive fixed owner-scoped views from hashes, stage validated envelopes and require exact SQL payload readback. They accept no arbitrary SQL, provider keys or admin queries. Its inference allowlist limits models, messages and token counts. It does not expose admin APIs, arbitrary SQL, private personal-use views or provider tokens.

The current tunnel is a temporary operator connection, with no uptime guarantee. The production portfolio and plan UI has no synthetic-data mode. Native account-owned AI/data providers operate independently of this optional gateway. A persistent operator connection needs a managed, monitored authenticated endpoint. Keep local services running for connected testing. The public URL is stable even if that optional connection is unavailable.

## Evidence

`evidence/firebase-deployment.json` records the Hosting release. `firebase-platform-checks.json` records current isolated hosted checks. `firebase-api-tests.json` is historical evidence for the earlier committee. `firebase-connected-application.json` records an actual queued public-URL run through Zetaris, Nightshift and H-MEM. Those runs use synthetic financial inputs. Private personal-use data and full private proofs stay outside the repository.

## Portfolio platform routes

The current application uses /api/platform for portfolio, watchlist, preferences, encrypted provider settings, source data, market scans, plans, agent runs, export and erasure. Cloud Tasks delivers plan/research work to /_internal/platform-jobs with its Google OIDC identity. Jobs use deterministic task names, execution leases and no automatic inference replay. Model receipts are persisted while work runs. Expired runs retain receipts and require an explicit new request.

Public client configuration is not a provider secret. Include both the app origin and web/firebase-config.json authDomain in the dedicated browser key referrers. The Google provider must be enabled and app origins must be authorized in Firebase Authentication. This authDomain restriction was checked against the real handler during release verification.

## Connected source reviews

Set `THESIS_ZETARIS_LAYER_URL` to the protected gateway origin and `THESIS_ZETARIS_LAYER_REQUIRED=true`. The deployment maps `THESIS_ZETARIS_LAYER_KEY` to the dedicated gateway secret. Usable quote, history and fundamental observations cross an owner-scoped actual SQL readback before use or cache delivery. Missing bridge configuration fails closed. Owner erasure is acknowledged before account records are removed, and source-stage timestamps prevent stale recreation.

The source-review action uses actual public filing snapshots with original metadata, not synthetic market fixtures. No new SEC request is made by the default snapshot path. The managed NVIDIA model and Zetaris services require the operator runtime to be available. Separate model passes use the same concrete model and do not establish model diversity.
