# The research universe contract

Thesis obtains its complete research universe through the qualified Zetaris view
`thesis.research_universe`. The view federates three physical sources on
`symbol`, `market` and `as_of`. It is not an unused sponsor side path.

The repository ships **synthetic fixtures** for reproducible judging. Company
names identify research examples. Every price, fundamental, growth driver and
stress scenario is fabricated for demonstration; investor-relations links are
source-discovery references and do not substantiate fixture figures. Querying
these fixtures through real infrastructure proves the data-layer integration,
not access to current market data.

## Rebuild and register

1. Run `npx tsx scripts/export-zetaris-data.ts` from the repository root.
2. Stage `prices.jsonl`, `fundamentals.csv` and `filings.jsonl` under
   `/home/zetaris/customer-data/thesis/` in the actual Zetaris driver. File URLs
   in the SQL refer to the driver filesystem, not the browser or this repository.
3. Inspect existing object names, then execute one top-level statement at a time
   from `data/zetaris/register.sql`. Its syntax follows Zetaris Lightning
   `CREATE LIGHTNING DATABASE`, `CREATE LIGHTNING FILESTORE TABLE` and
   `CREATE SCHEMASTORE VIEW` registration patterns. The public reference is the
   [Zetaris SQL Guide](https://kbase.zetaris.com/knowledge/sql-guide).
4. Execute `data/zetaris/verify.sql`; retain actual response bodies, row counts,
   request IDs and dates in a redacted evidence record. A prepared SQL file or a
   locally expected count is not live integration evidence.
5. Set the server-side Zetaris environment variables documented in
   `docs/sponsor-setup.md`, including `ZETARIS_STOCKS_VIEW=thesis.research_universe`.
   Set `ZETARIS_ALLOW_SAMPLE_DATA=true` only when intentionally exercising real
   infrastructure with these explicitly synthetic rows.
6. Run the application workflow. The typed adapter must accept the view output,
   then the quantitative engine recomputes risk from the returned price paths.
   A query-only test does not prove the complete application workflow.

`fixture-manifest.json` records deterministic SHA-256 hashes, expected rows and
`liveExecutionVerified: false`. This fixture manifest is never proof of a live
server call. A regenerated manifest is expected to remain byte-identical unless
the source fixture changes.

## Physical sources

| Feed | Format | Fixture rows | Responsibility |
| --- | --- | ---: | --- |
| `thesis_prices.records` | JSONL | 20 | Listing identity, local currency, snapshot date, 505 daily adjusted closing prices, cached summaries |
| `thesis_fundamentals.records` | CSV | 20 | Company identity, sector, financial inputs, initial thesis, catalyst and risk |
| `thesis_filings.records` | JSONL | 20 | Two provenance records per security, serialized as an evidence array |

The evidence feed contains one row per security/snapshot and a serialized array
with the underlying source records. This preserves independent ownership of the
source metadata without duplicating a security in the final view.

The view uses **left joins**. Missing fundamentals or evidence remain null and
fail the application contract. An inner join could silently hide a candidate
whose missing evidence should instead block the research run. Duplicate
market/symbol rows also fail the adapter. No browser-supplied SQL is accepted.

The latest `price` must agree with the final adjusted close within 0.1%; a larger
difference excludes the security. This contract uses the latest adjusted close,
not an independently changing intraday quote. Source IDs identify immutable
source records: an identical shared methodology record may be reused, but one ID
with contradictory metadata excludes every affected security. Conflicting records
are retained under unique `conflict-*` IDs in the dossier for inspection.

## View columns

The query response may use object rows or tabular rows with explicit named
columns. `prices` and `evidence` may be native arrays or JSON strings. All other
columns must have the types below; the registration SQL casts CSV numeric fields
explicitly to doubles. Camel-case SQL aliases match the TypeScript contract.

| Fields | Type | Meaning |
| --- | --- | --- |
| `symbol`, `name`, `exchange`, `sector` | string | Unambiguous listed security and company identity |
| `market` | enum | `US`, `India`, `China`, `UAE` |
| `currency` | enum | `USD`, `INR`, `CNY`, `AED`, or `HKD` listing currency |
| `price` | positive number | Latest adjusted local-currency closing price |
| `prices` | number array / JSON | 61–5,000 finite positive daily adjusted closes, oldest first; fixtures contain 505 |
| `annualReturn`, `annualVolatility`, `maxDrawdown` | number, percent | Cached summaries; the engine recomputes these and never trusts them for risk approval |
| `revenueGrowth`, `operatingMargin`, `dividendYield` | number, percent | Explicitly dated financial inputs; cannot silently mix quarterly and annual definitions |
| `debtToEquity`, `pe` | number, ratio | Financial input ratios, not percentages |
| `marketCapBn` | positive number | Market cap in billions of the security’s listing currency |
| `quality` | number 0–100 | An explainable input rubric, not a credit rating or probability |
| `catalyst`, `risk`, `thesis` | string | A research hypothesis, countercase and proposed business mechanism |
| `evidence` | evidence array / JSON | At least one price and one filing provenance record |
| `asOf` | ISO date string | Snapshot date; live stale/future snapshot rules apply |

Each evidence record contains `id`, `title`, `publisher`, `url`, `asOf`, `kind`,
`excerpt`, `sample`. Kinds are `filing`, `prices`, `macro`, `methodology`. Real
source URLs require HTTPS. Sample fixtures may use the explicit `#sample-*`
anchor form. Set `sample: true` on synthetic data and keep that flag through all
infrastructure, model and export layers. A real server does not make synthetic
source content real.

Live freshness is checked at both levels. The security `asOf` and every
`kind: prices` provenance date must be no more than 45 days old relative to the
run's evaluation time. A fresh wrapper date cannot make an old price source
current. Price and filing evidence dates more than one day in the future are
rejected; the one-day tolerance accommodates date-only/time-zone boundaries.
Exactly 45 days is allowed. An older annual filing remains a legitimate dated
source and is not subject to the price-age limit, though its relevance and
reporting period still require review. Sample mode replays the fixed synthetic
fixture clock and does not claim current financial observations, even when the
application runs years later.

## Replacing fixtures with real data

Replace each physical source with an appropriately licensed vendor or primary
source. Keep listing identifiers stable, use adjusted daily closes with a
consistent split/dividend policy, and retain the origin, fetch time and
reporting period of each financial number. The supplied `quality` score must
have an auditable rubric. Do not infer unknown values from zero defaults.

Use `sample: false` only for data actually retrieved and verified against its
claimed source. Primary filings should substantiate the financial figures and
business mechanism, rather than merely linking to a generic investor page. A
production feed also needs provider coverage/entitlement checks, liquidity and
market-access rules, FX normalization, corporate-action checks, data-refresh
monitoring and an applicable financial-services compliance review. Those are
operational requirements, not capabilities established by the synthetic fixture.

Thesis reports local-currency price returns, not portfolio or after-tax returns.
The capital input is a loss-budget illustration; no share allocation is computed
without valid FX and investability data. A return aspiration affects research
prioritization but never becomes a promised or inferred future return.
