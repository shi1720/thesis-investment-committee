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

Provision a Firebase web app, Hosting site, named Firestore database, Artifact Registry repository, Cloud Run service, Cloud Tasks queue and dedicated runtime/task-delivery service accounts. The runtime needs database-scoped `datastore.user`, task enqueue access, permission to act as the task-delivery account, and access only to its gateway secret. Task delivery uses a signed Google OIDC token; forged Cloud Tasks headers do not authorize execution.

The public Firebase client configuration is intentionally public and uses a dedicated key restricted to Authentication and Secure Token APIs plus Thesis hostnames. It cannot authorize database reads. For another deployment, replace `web/firebase-config.json`, the Hosting site ID and the resource IDs before building. Add its hostnames to Firebase Authentication's authorized domains.

The environment file contains `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID`, `PUBLIC_ORIGINS`, `CLOUD_TASKS_LOCATION`, `CLOUD_TASKS_QUEUE`, `CLOUD_RUN_SERVICE_URL`, `TASKS_INVOKER_SERVICE_ACCOUNT` and the non-secret provider URLs/model/view settings. Actual gateway credentials are injected through Secret Manager, with no value in source or command arguments.

## Connected local services

Zetaris and Nightshift run on the operator's machine. `scripts/provider-gateway.mjs` listens only on loopback and exposes a narrow authenticated bridge through an HTTPS tunnel. Its SQL allowlist permits only the synthetic public view, known markets and a fixed result limit. Its inference allowlist limits models, messages and token counts. It does not expose admin APIs, arbitrary SQL, private personal-use views or provider tokens.

The current tunnel is a temporary operator connection, with no uptime guarantee. Sample research remains available from the cloud independently. A commercial deployment must replace it with a managed, monitored authenticated connection and licensed financial-data access. Keep local services running for connected testing. The public URL is stable even if that optional connection is unavailable.

## Evidence

`evidence/firebase-deployment.json` records the Hosting release. `firebase-api-tests.json` records the isolated hosted checks. `firebase-connected-application.json` records an actual queued public-URL run through Zetaris, Nightshift and H-MEM. Those runs use synthetic financial inputs. Private personal-use data and full private proofs stay outside the repository.
