# Sponsor integration setup and verification

## Current V2 source workflow

The portfolio and account state live in Firestore. Actual usable **quote, history and fundamentals observations pass through Zetaris before cache writes, portfolio math, planning or agents consume them** when `THESIS_ZETARIS_LAYER_REQUIRED=true`. Native market-provider adapters remain the entitled upstream sources; they do not bypass the required financial source layer. Persistent cache hits and saved quote fallbacks are verified again. Missing/failed source delivery yields unavailable data, never synthetic replacements.

The keyless US source path uses the approved, original-dated AAPL/MSFT public SEC snapshots in `data/sec-snapshots/`. These contain observed filing facts and document provenance, with `dataMode: cached_snapshot`. The current attempted SEC refresh returned access-limited/unavailable, so **fresh SEC retrieval is not verified**. The source review makes no additional refresh attempt. Fiscal periods, filing dates and original recorded retrieval metadata remain visible. A successful Zetaris query verifies delivery integrity; it does not refresh source age, prove financial truth or create market prices. Quote-dependent ratios stay null.

“Review source evidence” uses deterministic source planning and a bounded model countercheck using the concrete `local-runtime/nemotron-mini-4b-instruct-q4-k-m` model through Meterless Nightshift. There is **one model pass and no model diversity claim**. Code planning is labeled separately from inference. The model returns a tiny schema of source coverage, a blocking gap and supplied evidence IDs. Server validation checks coverage, exact model identity and source binding; a model cannot approve an investment, invent prices/history, override an allocation or remove deterministic source gaps. At most two model calls including one repair are allowed. The decoding schema restricts citation IDs to the actual supplied enum; coverage and current-gap checks remain server enforced. Missing model availability produces an explicit incomplete report with usage/cost unknown when the provider did not report them.

Official Meterless H-MEM provides owner-scoped historical decision recall and audit archives. Historical decisions do not qualify as present financial evidence. Successful research/source reviews are remembered through the platform executor; deletion invalidates aggregate memory and stale results. Native NVIDIA, OpenAI, Anthropic and Gemini BYOK remain optional user settings with live catalogs, encrypted server-only keys and real connection tests. Native NVIDIA correctly waits for the user's key. This is distinct from the operator's local Nemotron route through Nightshift.

### Protected observation bridge

Configure only on the trusted application server:

```dotenv
THESIS_ZETARIS_LAYER_URL=https://YOUR_AUTHENTICATED_GATEWAY_ORIGIN
THESIS_ZETARIS_LAYER_KEY=DEDICATED_HIGH_ENTROPY_SERVER_SECRET
THESIS_ZETARIS_LAYER_REQUIRED=true
NIGHTSHIFT_BASE_URL=https://YOUR_AUTHENTICATED_GATEWAY_ORIGIN/v1
NIGHTSHIFT_API_KEY=DEDICATED_HIGH_ENTROPY_SERVER_SECRET
```

The gateway operator runs `node scripts/provider-gateway.mjs` with private `THESIS_GATEWAY_KEY_FILE`, `THESIS_CONNECTION_STATUS_FILE` and optionally `THESIS_ZETARIS_DRIVER_CONTAINER` paths. The status file references the private Zetaris credential file and Nightshift Runtime token file. Native sponsor/admin services stay loopback-only; a TLS tunnel reaches the narrow authenticated gateway. Cloud secrets are stored in Secret Manager, never shipped to the browser. The server gateway secret is distinct from native upstream credentials.

`POST /private-observations/roundtrip` accepts only a bounded normalized actual observation, opaque owner hash, kind, record key and original server operation start time. It stages JSON-array records into a named persistent customer-data volume, registers a fixed derived Lightning datasource and SchemaStore view, refreshes that source and reads exactly the matching owner/key/payload hash through actual Zetaris SQL. The returned canonical envelope must match the original hash exactly. No arbitrary SQL, path, host, administration endpoint or provider secret is accepted. Bodies are capped, redirects are refused, and failure messages omit upstream contents. Explicit synthetic/sample flags and credential/identity fields are rejected. This is source delivery integrity under trusted upstream adapters, not independent source attestation.

Owner identifiers are SHA-256 derived; directories have restricted filesystem permissions. This deployment uses one trusted operator/organization and one active gateway writer. It does not claim separate database principals for every customer, high availability or custom application AES encryption of Zetaris source files. Portfolio holdings, goals, user identity and API keys are never staged. Application BYOK encryption and Firestore state are separate from this observation store. A maximum of sixty-four source files per owner is retained; older-than-seventy-two-hour files are removed during subsequent staging. Operators must apply a lifecycle policy for inactive owners and runtime/backups.

`POST /private-observations/erase` removes the owner's staged source and temporary files and invalidates its fixed Spark table cache. A persistent opaque owner/erasedAt tombstone prevents operations started before erasure from recreating files, including after gateway restart. The application passes the original operation start before source fetching. Empty datasource/view metadata and the hash-only fence may remain; vendor audit logs/backups follow the operator's separate retention policy. The application requires a matching owner/fence acknowledgement, not just HTTP 200.

The gateway admits at most two active protected operations, with sixteen bounded FIFO waiters. Observations can wait up to thirty seconds; an initial model dispatch or erasure can wait up to ten seconds, leaving time inside its thirty-second client budget. Catalog discovery waits at most five seconds. Waiting requests that disconnect or expire are removed before upstream dispatch. Admission does not replay a generation, retry a provider 429, or change identity/hash gates. Upstream 429 and Retry-After remain forwarded. An already dispatched generation can still have unknown usage if its client cancels. Failure diagnostics record only enumerated component/phase/operation and HTTP status; they omit user identity, keys, bodies and financial values.

The older public synthetic SQL endpoint remains restricted to `thesis.research_universe` and cannot select an owner namespace. Synthetic demonstrations never count as actual observations in the new bridge.

### Verification and operating limits

`tests/zetaris-layer.test.ts`, `tests/source-review.test.ts` and `tests/gateway.test.ts` exercise mocked contracts, privacy boundaries, erasure fencing, model substitution and bounded invalid-output handling. They are not live sponsor proofs. Actual probe receipts belong in `evidence/` as sanitized metadata; full responses and operator configuration stay under ignored `work/private-proofs/`.

The current bounded local verification keeps the API at 512m maximum heap and Spark driver at 1g, with the unused vendor UI stopped. Actual SQL readback and normal Mini admission worked together; this is not a load or high-availability benchmark. Existing supported resource controls are `ZSPARK_DRIVER_MEM` and `ZETARIS_API_MAX_HEAP`. Changes require recreating the affected services, preserving named volumes and verifying SQL again. Spark documents a [one-gigabyte driver default](https://spark.apache.org/docs/latest/configuration.html#application-properties); that is not a capacity guarantee for arbitrary workloads. Nightshift's normal memory and thermal admission remains authoritative. If the local machine cannot keep the data layer and model ready together, a sequential component proof must be labeled operator-managed, with no always-on service claim. An unavailable model or source leaves the review incomplete.

### Current actual proof receipts

[Source-risk countercheck proof](../evidence/source-review-live.json) records two completed executions of the final focused workflow. Each performed an actual Zetaris readback and one accepted exact Nemotron Mini call through Nightshift. The follow-up recalled the preceding real source-gap decision with the pinned official H-MEM engine. The model used 398/63 then 442/63 input/output tokens, reported zero inference-provider USD, and preserved missing quote/history. This does not measure hosting, hardware or other infrastructure cost. The proof uses private file persistence for engine snapshots; hosted browser and Firestore end-to-end execution remain a separate verification step.

[Observation and erasure proof](../evidence/zetaris-observation-live.json) records actual owner/payload SQL receipts, a matching erase acknowledgement, zero remaining owned source files, and rejection of a stale operation both before and after gateway restart. Full envelopes, any historical context text and operator configuration stay in ignored work files. The published metadata contains no provider keys, investor preferences, raw vendor observations, prompt previews or model narratives.

Restart the gateway after recreating the Zetaris driver so its process-local datasource registration cache is rebuilt. The native API exposes public SQL on 8888 and internal authentication on 8889; the optional vendor UI is a separate service on 3000. Use the actual configured loopback ports, with no public exposure of native services.

## Legacy V1 verification and sample committee

The sections below document the original sample-universe committee and earlier isolated sponsor verification. They are retained for reproducibility and are not the V2 default data or provider workflow. The included twenty-company universe is synthetic, even when queried through genuine sponsor infrastructure. Earlier private vendor-price experiments are not bundled in V2 public SEC snapshots.

## Meterless Nightshift

The adapter implements the [official provider contract](https://github.com/Meterless/Meterless/blob/main/docs/agent-ready/add-meterless-provider.md) and [hotspot connection contract](https://github.com/Meterless/Meterless/blob/main/docs/products/nightshift/hotspot.md).

1. Install and open the appropriate [Nightshift edition](https://meterless.ai/), then configure a model through its normal controls.
2. Obtain its real Runtime proxy token through the application. `rt-local` is not a valid substitute. Set the token in the server environment; do not commit it.
3. Configure:

```dotenv
NIGHTSHIFT_BASE_URL=http://127.0.0.1:8088/v1
NIGHTSHIFT_API_KEY=YOUR_REAL_RUNTIME_PROXY_TOKEN
NIGHTSHIFT_MODEL=meterless/auto
NIGHTSHIFT_TIMEOUT_MS=60000
```

For the verified native local configuration, `NIGHTSHIFT_MODEL=local-runtime/qwen2-5-7b-instruct-q4-k-m` selects the installed Qwen2.5-7B-Instruct Q4_K_M lane. The adapter requests structured `json_schema` output, which was accepted by the installed Nightshift 1.2.4 native Metal runtime. Editions that reject structured responses are unsupported by this adapter; it reports failure rather than silently parsing an unreliable plain-text answer.

The adapter normalizes common pasted URL suffixes, sends Bearer auth, `meterless-app: thesis` on every request and `meterless-scope: user` on chat requests. `/v1/models` establishes online/auth status; `/healthz` is not used as proof. Catalog entries alone do not prove a model lane is ready.

At most three surviving candidates enter one skeptical review. A deterministic evaluator checks schema, exact candidate identities, citation membership and price/filing coverage. It rejects all digit-bearing narrative claims and explicit return forecasts or certainty claims, then permits one bounded qualitative repair. These conservative checks do not establish semantic entailment or fact-check a qualitative claim; model prose remains an unverified research critique. Rejection delegates one repair. When omitted, the adapter deadline defaults to thirty seconds per logical request. The verified local setup uses the explicitly configured sixty-second deadline above. Network timeouts are not automatically replayed, because generation may already have occurred. Impossible mandates and fully rejected universes make zero model calls.

`evidence/nightshift-live.json` records a fresh, successful Thesis review through the actual local Runtime. It identifies the concrete returned model, tokens, latency and receipt ID. Where present, the adapter records Nightshift's `meterless.routed_model`, winning provider, reported cost and runtime receipt body. A routing alias such as `meterless/auto` alone never proves NVIDIA execution. Retaining a runtime receipt body does not establish cryptographic signature verification.

### NVIDIA

Configure NVIDIA-hosted models in **Nightshift → Providers**, keeping the NVIDIA
API key out of the Thesis project. Alternatively install a supported local
Nemotron model through Nightshift's normal controls. Discovery alone does not
establish readiness; the request must return a concrete model receipt.

The optional exclusion-auditor feature is selected with:

```dotenv
NIGHTSHIFT_AUDITOR_MODEL=local-runtime/nemotron-mini-4b-instruct-q4-k-m
```

`evidence/nemotron-live.json` retains two real requests through Nightshift's native
Metal runtime for NVIDIA Nemotron Mini 4B Instruct Q4_K_M. The model requested a
review of synthetic evidence while the original deterministic exclusion remained
binding. `evidence/nemotron-model-provenance.json` records the local weight digest
and upstream model identity. This establishes a working optional feature rather
than a catalog listing. The recorded public Cloud Run workflow used Qwen only;
it must not be presented as a Nemotron-reviewed decision. The earlier unavailable
lane attempt is historical and does not negate the retained successful feature
proof.

## Meterless H-MEM

The complete official TypeScript reference engine is vendored at `lib/providers/meterless-hmem/`, pinned to commit `1742dec56a66e58eef9dda2d2b865823758ca8cd`. The Apache-2.0 license, upstream link and import-extension adaptation are retained there. This is the official reference runtime, not a renamed application memory heuristic.

`lib/providers/hmem.ts` uses its `HMEM`, `MemoryStoreService`, `MemoryRetrievalService` and `TrustLedgerService` to capture previous decisions with source provenance, recall relevant lessons through the canonical hybrid formula, and preserve explicit preference supersession. The application supplies persistence rather than relying on the engine filesystem. The public Firebase deployment persists each verified user's bounded context snapshot in the named Firestore database; the alternate Sites deployment uses D1. The saved snapshot is supplied on the next request. Snapshots retain at most 256 records and the latest 512 audit entries; evicted context records and rotated audit entries are exported through `pendingArchive` and written into a separate immutable, user-scoped audit archive in the selected application store before the clean snapshot is saved. Deleting any research run invalidates the aggregate snapshot and its audit archives, so a deleted decision cannot reappear through recall; the next session can rebuild from the user's remaining runs. Account erasure removes all of these records. Previous numerical decisions are historic context, never new financial evidence.

Tests in `tests/providers.test.ts` verify persisted round-trip recall, correct source rejection, the exact negative feedback delta, supersession links and preservation of earlier audit entries. The pinned official upstream H-MEM conformance runner also passed all 13 of 13 checks on this vendored engine; the result is retained in `evidence/hmem-conformance.json`. Reproduce it with `HMEM_IMPL="$PWD/lib/providers/meterless-hmem/index.ts" npx tsx lib/providers/meterless-hmem/conformance/runner.ts`. This verifies engine behavior, separately from the product tests.

## Zetaris

The implementation follows the official [Zetaris getting-started TypeScript query helper](https://github.com/zetaris/getting-started/blob/main/scripts/query_zetaris.ts) and [direct REST helper](https://github.com/zetaris/getting-started/blob/main/scripts/zetaris_sql.py). The older [knowledge-base REST page](https://kbase.zetaris.com/knowledge/rest-api) links to an unavailable Postman repository, so Thesis uses these current published contracts.

Provision your licensed Zetaris instance through the supplied Cloud Gateway account or vendor-supported local bundle. The Cloud Gateway login page itself is not the SQL API. Set a read-only, organization-scoped token and choose one API mode:

```dotenv
# SQL Workspace proxy at the UI origin:
ZETARIS_BASE_URL=https://YOUR_ZETARIS_INSTANCE
ZETARIS_API_MODE=proxy
ZETARIS_API_KEY=YOUR_READ_ONLY_TOKEN
ZETARIS_ORG_ID=1
ZETARIS_STOCKS_VIEW=thesis.research_universe
# Optional engine selection for proxy mode:
ZETARIS_ENGINE_ID=
```

Or use the direct Lightning REST API:

```dotenv
ZETARIS_BASE_URL=http://127.0.0.1:8888/api/v1.0
ZETARIS_API_MODE=direct
ZETARIS_API_KEY=YOUR_READ_ONLY_TOKEN
ZETARIS_ORG_ID=1
ZETARIS_STOCKS_VIEW=thesis.research_universe
```

Proxy mode sends `POST /api/proxy/sql-editor/sqls/run-query` with `{sql,limit,engineId?}`. Direct mode sends `POST /sql-editor/sqls/run` with `{queryId,sql,source:'SqlEditor',limit}`. Both include `Authorization: Bearer`, `X-Org-ID` and `X-Request-ID`.

The application accepts only a single read-only `SELECT`, validates the configured qualified view name, selects from a fixed market enum and caps the universe at 1,000 rows. Each row must satisfy the `Stock` schema, contain at least 61 adjusted price observations and carry price plus filing provenance. Numerical decision metrics are recomputed from the price path. The upstream JSON response is bounded to two megabytes while streaming and cancelled before excess bytes are buffered. Invalid, duplicate, out-of-market or incomplete rows fail the entire read; they are never silently discarded. Connection failures, unauthorized credentials and invalid responses are distinct.

`prices` and `evidence` may be native JSON arrays or serialized JSON strings. Object rows, the verified native `{headers,data}` response and named `{columns,data}` variants are supported. Duplicate/mismatched tabular headers are rejected. The native API serializes numeric cells as strings; only finite canonical numeric strings in known scalar fields are normalized. Empty, null, whitespace-only or formatted values are never coerced to zero. Prices/evidence retain strict typed validation. Use the source exporter and registration SQL in `data/zetaris/` to reproduce the included synthetic-source federation. The verified native reader requires JSON arrays from `prices.json` and `filings.json`, plus `fundamentals.csv`. JSONL is retained for portable interchange but is not registered: this server version read only one JSONL record. Registration uses plain absolute paths under `/home/zetaris/customer-data/shared/thesis/`, rather than `file://` URLs. `npx tsx scripts/sponsor-seed.ts --stage-container YOUR_ISOLATED_DRIVER_CONTAINER` stages the three included source feeds, executes only the prepared Thesis namespace declarations, and verifies the delivered 20-stock universe. It writes `evidence/zetaris-live.json` only after the actual query satisfies every source contract. `npx tsx scripts/sponsor-proof.ts` then exercises the queried universe, official H-MEM recall and a real Nightshift skeptical review in one workflow; `--nightshift-only` deliberately omits Zetaris and labels that narrower proof. Each stock's evidence and the entire selected universe must be consistently synthetic or actual. Duplicate market-symbol pairs and globally ambiguous symbol codes, ignoring case, reject the read; distinct listings require unique exchange-qualified codes.

For **connected sponsor demonstration over the synthetic fixtures only**, explicitly set:

```dotenv
ZETARIS_ALLOW_SAMPLE_DATA=true
```

The application must retain sample labels and describe a real infrastructure run over synthetic data. Remove this setting when supplying actual permissioned financial data; never relabel synthetic rows as actual observations.

## Hosted and local boundaries

Neither a hosted Cloud Run service nor a Cloudflare Worker can reach the laptop's `127.0.0.1`. Use authenticated HTTPS endpoints reachable from the hosted runtime for connected research, or run the application locally beside the sponsor services. Keep secrets in runtime environment configuration only. The published sample experience needs no sponsor credentials. The public Firebase deployment uses a narrow authenticated HTTPS gateway to local sponsor services, persistent Cloud Tasks dispatch and account-scoped polling. Its public query allowlist includes only the synthetic view, not the private personal-data namespace. See `firebase-backend.md` for the identity and durable-job boundary.

`getProviderStatuses` reports **configured**, not verified, when credentials merely exist. Successful per-run query/model receipts establish verification. The bundled H-MEM feature is independently usable without a model key.

## Run the tests

```bash
npm test
npm run typecheck
```

Provider tests use deterministic mock transports to exercise auth, endpoint contracts, unsafe SQL rejection, structured-output repair, foreign-citation rejection and honest model identity. Mock tests prove application behavior; only retained fresh connection proofs establish real sponsor execution.

## Private actual-data proof handling

When source rows are actual rather than synthetic, `scripts/sponsor-proof.ts` writes its complete proof only to the ignored `work/private-proofs/` directory with private file permissions. Its tracked `evidence/` output uses an explicit metadata allowlist: provider and model identity, opaque request/receipt IDs, token usage, latency, provider compute cost, row/request counts and validation outcomes. It omits user preferences and capital, stock identities, financial figures, risk metric values, source excerpts, narratives, prompt previews and raw runtime receipt bodies. The verified private actual snapshot can produce policy abstention under its mandate. A successful source query and an abstained actual-data result establish data ingress and decision enforcement; they do not establish a completed model-generation call. Zero generation is never described as a model inference proof. Retaining private input records for personal research does not grant commercial or redistribution rights. The synthetic judge fixtures continue to be fully reproducible and shareable.
