# Thesis: product and commercial thesis

Built by Shivam Gupta for Open Agent Hackathon 2026. Primary track: Reasoning Architecture.

## The problem

A self-directed investor can find a stock screener, a persuasive AI answer, and a financial dashboard. The harder job is deciding which apparent opportunities deserve further investigation under an explicit risk budget, then remembering what would invalidate that decision.

The first target user is a globally minded, self-directed investor with an existing brokerage account, comparing a small number of listed companies across the US, India, China and the UAE. A second potential customer is a small independent research team. Thesis does not open accounts, route orders, manage assets or promise returns.

The core job is concrete: “Given these research constraints, produce a defensible shortlist, show the countercase and rejected alternatives, and leave me a reviewable decision record.”

## The product wedge

Every candidate has a research case, a counterargument, a deterministic risk check, a source register, and an observable thesis invalidation condition. The product can abstain when preferences conflict or no candidate passes. User risk limits survive model commentary.

Return aspirations are separate from evidence. Annualized volatility describes the variation of historical returns. Historical drawdown describes a previous peak-to-trough decline. Neither gives a future loss ceiling. Cross-market results stay in listing currency until an actual FX history supports conversion.

The product distinguishes sample fixtures, a successful sponsor connection, and financial evidence. A real language-model call over synthetic data remains a sample-data demonstration.

## Competitive context

These are public vendor statements checked on 27 October 2026, not independent assessments of feature quality.

- [Koyfin](https://www.koyfin.com/Pricing/) already offers global company research, screeners, charts, watchlists and filings. Its page lists paid individual plans alongside a free tier. Thesis should not compete on the volume of financial dashboards.
- [Stock Analysis](https://stockanalysis.com/help/data-and-downloads/about-our-data/) describes broad global coverage and multiple licensed financial-data providers. A new entrant should not assume it can reproduce that data breadth at zero cost.
- Thesis's proposed differentiation is a persistent record of why a candidate passed, why another failed, what contradicted the thesis, and what warrants reconsideration. This is a product hypothesis. No claim of unique market ownership or validated customer demand is made.

## Initial business model to test

Pricing hypotheses, not launched offers:

| Tier | Hypothesis | What must be true |
| --- | --- | --- |
| Explorer | Free, limited synthetic/public-data research | Useful onboarding without misleading live coverage or uncontrolled inference cost |
| Individual | $19/month for a bounded research allowance and saved dossiers | Users repeatedly review theses and value the evidence/countercase workflow |
| Research team | $79/month for a small team with shared review workflows | Team collaboration, licensing, account permissions and compliance obligations are implemented first |

There is no checkout or subscription billing in this build. Never present hypothetical revenue as traction. Avoid broker referral commissions during validation because they can create an incentive to encourage unnecessary activity.

## Cost discipline

The deterministic screen runs before model requests. An unsuitable mandate can terminate before inference. Nightshift receives a compact shortlist of at most three candidates, rather than every company in the universe. Calls have deadlines, bounded repairs and explicit usage receipts. H-MEM recalls relevant previous decisions instead of including complete histories.

For a hypothetical $19 monthly plan, set a provisional variable-cost ceiling of $3.80 per active subscriber to target an 80% contribution margin before salaries, support, payment fees and fixed infrastructure. This is arithmetic, not a validated business forecast. Licensed market data, exchange redistribution rights, sponsor licensing and support may dominate model cost. Measure those costs before selling live access. A provider report of $0 inference on a local computer excludes hardware, electricity and operation.

No estimate of annualized investment outperformance, saved hours, conversion or willingness to pay has been established.

## Validation plan

1. Recruit five self-directed investors for observed research sessions using a historical, permissioned dataset.
2. Ask each to investigate the same candidate independently and with Thesis. Record completion time, unsupported claims accepted, risk breaches missed, and whether they can explain the countercase.
3. Test a contradictory mandate. Success requires a clear abstention and no invented picks.
4. Revisit a saved thesis after a changed evidence record. Evaluate whether the user understands why the decision changed.
5. Offer a paid pilot only after data licensing and jurisdiction-specific advice boundaries have been reviewed.

Provisional product gate: at least four of five users can identify the main risk and invalidation trigger without assistance, with zero deterministic risk-gate breaches. This small usability study would not validate investing performance or a commercial market.

## Durable advantage to develop

A model wrapper is easy to reproduce. A useful advantage could come from reliable cross-source financial mappings, auditable evidence history, user corrections and a growing set of reviewed decision outcomes. That advantage requires reliable data rights, longitudinal evaluation and customer trust. H-MEM is open source and is not itself a proprietary moat.

## Launch boundaries

The current build is a production-oriented hackathon implementation with durable records, account access, defensive API validation, real sponsor adapters and offline sample mode. Full commercial readiness still requires verified live financial-data coverage, external security testing, monitoring and backups, jurisdiction-specific review, and demonstrated customer demand. Calling this an audited production investment adviser would be inaccurate.
