# Sponsor integration setup and verification

Thesis uses a real Meterless H-MEM engine in every research session. Connected research additionally reads the investment universe through Zetaris and sends the bounded skeptical review to Meterless Nightshift. No other model provider is called directly.

**Data truth:** the included twenty-company universe is synthetic. Real sponsor execution over these records verifies the software integrations; it does not turn the examples into live market observations. All sample evidence remains labeled. An optional private personal-use US importer has produced a validated actual record in a separate verified Zetaris namespace. This is a limited actual-data path, not licensed commercial coverage of the four markets.

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
