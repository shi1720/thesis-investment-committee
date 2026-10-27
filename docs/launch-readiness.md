# Launch readiness

Thesis is a tested, production-oriented hackathon build. This document separates working behavior from unverified production prerequisites.

## Implemented

- Account sign-in through the hosting platform and authorization on personal records.
- Durable D1 research history, saved theses, notes, account export and deletion endpoints.
- Strict preference validation, streamed request/provider size limits and same-origin mutation defenses.
- Idempotency for completed research, server-side rate limiting and bounded model repair.
- Price-derived risk checks, counterarguments, actual critique revisions and abstention.
- Source-integrity checks, sample/live separation, model/receipt provenance and explicit degraded states.
- Official Meterless H-MEM recall with bounded active context and archived audit history.
- Responsive interface, comparison and exportable research dossier.
- Automated research/provider tests, end-to-end API tests and a reproducible sample mode.

## Required before selling live access

- Confirm market-data licenses and redistribution rights for each exchange, listing and field. International coverage cannot be inferred from a sample universe.
- Connect and verify actual price histories, fundamentals and filing excerpts through Zetaris. Fixture federation proves infrastructure use, not data accuracy or market coverage.
- Test performance and source freshness across market closures, corporate actions, restatements, missing sessions, currency changes and symbol delistings.
- Extend daily price arrays with explicit timestamps and adjustment lineage before integrating less controlled feeds. The current data contract assumes ordered daily adjusted closes.
- Review investment-research/advice boundaries and marketing claims for the intended jurisdictions. No legal compliance certification exists.
- Complete external security assessment, production monitoring, backup/restore exercises, abuse testing and load testing.
- Add a durable background-job queue and recovery for interrupted long provider calls. An interrupted running request currently requires a new request key after operator/user review.
- Define and automate a data-retention policy. Account export streams retained completed runs rather than truncating to the UI history window.
- Validate paid demand, pricing and actual variable costs. No customer traction, alpha or time-saving claim has been established.

## Deliberate product limits

- Fit scores rank research priorities and are not probabilities of future success.
- Return aspirations do not create forecasts. No guaranteed returns or loss caps exist.
- Metrics use listing-currency price returns. Dividends, fees, taxes, FX-adjusted returns, liquidity and portfolio correlation require separate work.
- Stress scenarios use stated assumptions rather than calibrated financial models.
- Citation-ID checks do not establish that a model interpretation is true. Users must review original sources.
- No brokerage account, allocation order, automated investment action, payment or subscription billing exists.
