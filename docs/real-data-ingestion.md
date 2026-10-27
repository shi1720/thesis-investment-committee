# Actual US data ingress for private personal research

The optional importer retrieves actual daily prices and SEC-reported financial
facts, derives an auditable research record, and prepares the same three-source
Zetaris contract used by the application. It does not turn the sample universe
into live coverage, and it does not supply a commercial market-data license.

## Scope and rights

This path is restricted to **owner-private personal research**. The CLI requires
`--personal-research`; `--commercial` and `--public` are refused. Only two verified
US identities, AAPL and MSFT, are supported. A successful request to a public
endpoint establishes technical availability, not permission to redistribute it.
Review the providers' terms for your intended private use before importing.

The [yfinance project's own notice](https://github.com/ranaroussi/yfinance)
identifies its Yahoo access as unofficial, intended for research/education, and
personal use. Thesis does not claim Yahoo endorsement, a service guarantee or
commercial rights. The actual vendor price series and derived numerical output
must remain in ignored private working files and the owner-private data layer;
never add them to the public repository or a public demo. Use the synthetic
fixtures in public screenshots/video unless a suitable data license permits more.

The [SEC documents its public data APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
as keyless. Its [reuse FAQ](https://www.sec.gov/about/webmaster-frequently-asked-questions)
permits reuse of public EDGAR filing content, subject to fair access. Set a real
application/contact User-Agent. The importer makes sequential bounded requests,
uses fixed provider hosts, and stops on HTTP refusals without access workarounds,
cookie tricks, header spoofing or automatic refusal retries.

## Usage

From the repository root:

```bash
export SEC_USER_AGENT='Your Name your-real-contact-email@example.com'
npx tsx scripts/import-market-data.ts \
  --personal-research \
  --symbols AAPL \
  --output work/private-us
```

Credentials/contact settings belong in environment variables. No API key is
required by this particular SEC/Yahoo personal path. The program refuses raw
vendor-data outputs inside tracked source directories; use its ignored `work/`
folder or an explicitly private directory outside the repository.

For an already obtained, trusted private cache:

```bash
npx tsx scripts/import-market-data.ts \
  --personal-research \
  --symbols AAPL,MSFT \
  --cache /absolute/private/cache \
  --output work/private-us
```

Cache filenames are `sec-aapl-companyfacts.json`,
`sec-aapl-submissions.json`, and `yahoo-aapl-chart.json` (and corresponding MSFT
names). They must be actual provider responses obtained under the relevant
terms. Cache mode validates supplied content; it does not independently attest
its origin. The Yahoo request used for a cache must include `events=splits` and
`interval=1d`. Price-source dates remain the last observed market session, not
the cache-read or fetch time. Stale data is rejected.

Each accepted security produces private `prices.jsonl`, `fundamentals.csv`,
`filings.jsonl`, `research-universe.json`, `field-lineage.json`,
`import-manifest.json`, and `register-private.sql`. Missing required facts produce
an explicit rejection in the manifest, never fabricated defaults. The CLI prints
only accepted identities, dates/counts and rejection reasons, not raw prices or
financial values.

## Stage through Zetaris

1. Stage only accepted private feeds into the actual Zetaris driver at
   `/home/zetaris/customer-data/thesis-personal/`.
2. Inspect existing objects, then run the prepared `register-private.sql` one
   statement at a time against your licensed instance. It creates distinct
   `thesis_personal_prices`, `thesis_personal_fundamentals` and
   `thesis_personal_filings` source databases and the qualified view
   `thesis_personal.research_universe`.
3. Set the server-side `ZETARIS_STOCKS_VIEW=thesis_personal.research_universe`.
   Keep `ZETARIS_ALLOW_SAMPLE_DATA=false` for this actual-source path.
4. Run an authenticated connected brief in the owner-private application. Select
   US for the verified coverage. If the mandate requests an additional market
   with no delivered records, the committee explicitly warns that coverage is
   unavailable rather than implying it researched that market.
5. Retain complete actual-source query and application proof privately. Public
   integration metadata may identify providers, scope, dates, record counts and
   concrete models, but must not include vendor prices or derived numerical
   market output without redistribution permission.

The three feeds share the observed price snapshot as their `as_of` join key.
Underlying annual financial periods, balance-sheet dates and filing publication
dates are preserved separately in the field lineage and evidence. The join key
does not refresh an older financial fact.

## Calculation and source fidelity

| Field | Exact interpretation |
| --- | --- |
| Revenue growth | Comparable annual revenue periods in the same latest annual filing, with the same concept and USD unit |
| Operating margin | Operating income divided by revenue for that same annual period/filing |
| Financing debt/equity | Current and noncurrent long-term debt plus separately reported short-term borrowing component, divided by same-date stockholders' equity; excludes leases |
| P/E | Last observed close divided by latest annual diluted EPS; a dated annual proxy, not TTM/forward P/E |
| Dividend yield | Latest declared annual dividend per share divided by last observed close; a dated annual proxy, not a forward yield |
| Market capitalization | Last observed close times latest reported common shares; a dated proxy that can differ after subsequent issuance/buybacks |
| Quality | A disclosed derived heuristic: 35% growth component, 35% margin component, 30% financing-leverage component; not an external rating or observed financial fact |

The quality components are `clamp((growth + 5) / 25)`,
`clamp(margin / 40)`, and `clamp(1 - debt/equity / 2)`, with each clamp between
zero and one. Weights sum to 100. These research thresholds have no claimed
predictive calibration.

Only official standard SEC concepts and units are used. Future-filed values are
excluded. Annual duration, reporting periods, accession identity and balance
contexts are checked. A deprecated/stale concept cannot silently substitute for
a current annual field. The SIC-to-sector mapping is explicitly limited to the
two verified identities, not a generalized classifier for every company.

AAPL's capital-structure mapping includes separately disclosed commercial paper.
MSFT's missing same-period short-term-borrowing component currently causes a
rejection. An absent XBRL tag does not mean zero. Add a reviewed, source-cited
filing mapping before expanding acceptance; do not copy its synthetic fixture
fundamentals into an actual-source record.

Filing evidence contains exact selected XBRL values, units, reporting periods,
publication dates, accessions and links to the primary filing, plus clearly
identified Thesis transformations. These are structured reported facts, not
claimed verbatim narrative quotations. Catalyst and risk text are explicitly
neutral **research hypotheses**, not fabricated company news.

## Price adjustment semantics

The personal adapter uses `indicators.quote.close`, deliberately ignoring Yahoo
`adjclose`. Yahoo's [adjusted-close help](https://in.help.yahoo.com/kb/adjusted-close-sln28256.html)
explains that adjusted close incorporates dividends as well as splits; using it
silently would contradict the application's price-return methodology.

This narrow adapter accepts only histories with **no split reported in the
explicitly requested window**. It rejects a split event rather than infer an
adjustment or substitute dividend-adjusted values. Missing/null observations,
unordered/future timestamps, mismatched USD/ticker/daily metadata and stale last
sessions also fail closed. Price dates are preserved in private lineage. Provider
completeness still requires review; this is not an exchange-certified feed.

## Commercial route and missing credentials

Before offering this to other users, obtain a documented quote/history provider
entitlement for the intended display and distribution. A private personal-use
acknowledgement does not create those rights.

One documented option is [Twelve Data](https://twelvedata.com/docs). Create an
account at [registration](https://twelvedata.com/register), obtain the key in its
dashboard, and verify the required exchange and usage entitlement. Its
[individual pricing](https://twelvedata.com/pricing) distinguishes the free Basic
internal non-display plan from paid internal display access. Its
[terms](https://twelvedata.com/terms) separately restrict external redistribution.
A free key alone therefore does not establish permission to show this app's
quotes to end users. Request the appropriate written commercial/display rights
before configuring a production key. Use the documented header
`Authorization: apikey …`; never put the key in a public query URL or source file.

Twelve Data [documents daily split adjustment](https://support.twelvedata.com/en/articles/5179064-are-the-prices-adjusted).
An entitled integration should retain its daily timestamps, adjustment policy
and actual source dates. Alpha Vantage's [documentation](https://www.alphavantage.co/documentation/)
labels its daily adjusted endpoint premium, while its free compact daily series
is raw and limited; it must not be substituted without handling adjustment and
usage rights. No paid provider key, commercial entitlement, or verified India,
China or UAE actual-source coverage is claimed by this importer.
