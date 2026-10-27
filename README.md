# Thesis

**Conviction, with a counterargument.**

A portfolio and investment research workspace with personal goal planning, observed market evidence, quantitative screens and specialist AI critique.

[Open Thesis](https://thesis-investing.web.app). A private guest workspace opens automatically. Connect Google to keep access across browsers and devices.

## The application

- Record buys and sells, edit transactions, reconcile FIFO or average acquisition cost, and inspect realized gains. Currency groups remain separate without an actual FX valuation. Missing or stale quotes are withheld from aggregate valuations.
- Explore US, India, China and UAE listings. Choose multiple sectors, search provider listings and save a watchlist. The initial catalog contains verified listing metadata, not fabricated prices or fundamentals.
- View dated API history or a separately attributed official TradingView chart. Embedded chart data is never extracted into AI, portfolio P&L or allocation calculations.
- Run an explicit bounded quantitative cohort scan. Value, quality, price momentum excluding the latest month, and low-volatility ranks require sufficient dated peers. A composite requires all four factors. Missing descriptors remain unavailable.
- Review dated public SEC filing facts for supported snapshots through actual owner-scoped Zetaris readback. A managed NVIDIA Nemotron countercheck runs through Nightshift against a deterministic source plan. Missing quotes/history stay binding, and official H-MEM recalls historical context separately.
- With compatible configured models and source access, run planner, fundamentals, quantitative, news, skeptic and evaluator stages with actual model calls, bounded source tools, source IDs, receipts, critique and validation. Historical memory uses the official Meterless H-MEM engine with account namespaces and erasure generations.
- Build a plan from amount, country, currency, goal, horizon, loss comfort and optional market preferences. Deterministic sizing conserves every currency cent, applies position/sector/market limits and checks observed risk. An optional AI critique cannot change weights. A firm essential goal within two years reserves principal instead of forcing equity exposure.
- Configure NVIDIA, OpenAI, Anthropic, Gemini or the operator Nightshift route. NVIDIA is the default selection. Authenticated model catalogs are discovered dynamically; actual inference testing is a separate action. Assign providers and models by agent role.
- Configure entitled Finnhub, Twelve Data or Alpha Vantage feeds, with explicit sources by purpose. Keys are encrypted per account. Provider quotas, missing entitlements and unavailable histories are surfaced rather than replaced with synthetic data. Optional Brave or Tavily enables general web search. Public GDELT headlines keep index dates distinct from publication dates.

No automatic trading, deposit yield, expected return or eligibility to buy a foreign security is assumed. Allocation applies to the new lump sum, not a full portfolio rebalance. Recorded trades require broker reconciliation for corporate actions and unrecorded income.

## Try the workflow

1. Open the app in a private guest workspace. In Investment plan, choose a home goal, USD10,000, India residence,24 months and a firm deadline. Review the risk and optional market choices, then create the plan. Expect a conditional principal reserve with exact budget conservation, not invented stock returns or deposit rates.
2. Add an illustrative manual holding only if desired. A user-entered purchase price is recorded cost, not a current market quote. The separate TradingView chart retains attribution.
3. Open AAPL in Markets and choose Review source evidence. The completed source review shows original-dated SEC snapshot facts, a verified Zetaris read, the actual Nightshift/NVIDIA receipt and binding missing quote/history. Repeat after completion to inspect relevant historical context. Managed reviews depend on the operator runtime and are rate limited.
4. For broader research or quantified allocations, configure compatible model accounts and appropriately entitled market-data keys in Settings. Catalog discovery does not establish inference capability. Source outages and insufficient histories remain visible.

## Run and deploy

Node.js 24.12 or newer is required.

```bash
npm ci
npm run typecheck
npm test
npm run build:web
npm run build:api
```

The production application uses Firebase Hosting, Google Cloud Run, Firebase Authentication, a dedicated named Firestore database and authenticated Cloud Tasks. See [Firebase deployment](docs/firebase-deployment.md). The API requires its server environment and an application encryption key from Secret Manager. Configure personal provider keys inside Settings, never in the browser bundle or repository.

```bash
THESIS_CLOUD_ENV=/absolute/private/cloudrun.env.yaml npm run deploy:firebase
```

The deployment script builds, tests, deploys the API, releases Hosting and runs isolated authenticated checks against the hosted application. `npm run test:firebase` creates disposable anonymous accounts and removes their workspace data and identities afterward. `THESIS_TEST_URL` supports loopback development; `THESIS_TEST_ORIGIN` supplies its allowed web origin.

## Project presentation

[Watch the narrated walkthrough](https://www.youtube.com/watch?v=5PKiqeFUydY). [Pitch deck](submission/thesis-pitch-deck.pdf) and [editable PowerPoint](submission/thesis-pitch-deck.pptx). The narrated product walkthrough uses actual captured application views, clearly labeled illustrative inputs and a generic AI-generated voice. English captions are retained in `submission/thesis-product-demo.en.srt`.

## Evidence and limits

The current source has automated finance, FX, provider-contract, encryption, planning, account-merge, memory and quota tests. Authenticated API checks exercise real Firestore persistence, ownership, ledger edits, masked settings, exact-budget plans, job polling and erasure. The evidence directory records the verification time and scope.

The direct NVIDIA, OpenAI, Anthropic and Gemini adapters have contract coverage. A dedicated temporary Gemini key successfully discovered its live catalog; its inference attempts returned HTTP 402 because that account required billing/credits. The temporary key was deleted and no generation was replayed. Successful inference with those accounts still requires appropriately credited account keys. No entitled stock-data key is bundled. A successful live catalog or quote does not prove another endpoint's coverage or entitlement. The operator Nightshift connection has separately completed actual local inference; its temporary gateway has no uptime guarantee.

Historical evidence from the earlier focused research committee remains in the repository. It includes real Zetaris and Nightshift round trips plus explicitly synthetic source-contract fixtures. Those records are not current prices and the production portfolio UI has no synthetic-data mode. The focused v2 source-risk workflow is verified separately in `evidence/source-review-live.json` and `evidence/zetaris-observation-live.json`. Native personal provider paths are optional and are not a claim that every provider has completed live inference.

[Financial methodology](docs/finance-methodology.md) explains the arithmetic and its limits. [Data and privacy](https://thesis-investing.web.app/privacy.html) describes storage and account controls. Model citation membership checks do not prove factual entailment.

## Source

The maintained branch is `main`: [shi1720/thesis-investment-committee](https://github.com/shi1720/thesis-investment-committee). Built by Shivam Gupta with AI-assisted engineering.
