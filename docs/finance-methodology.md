# Real-data finance methods

The new finance modules are independent of the labeled synthetic hackathon
fixtures. They never manufacture missing prices, filing ratios, news, FX or bank
rates. They provide research calculations, not an alpha forecast or an executable
investment recommendation.

## Price history and factor features

`analyzeHistory` uses dated observed daily closes. Corporate-action adjustment,
source currency and exchange timezone stay attached to the series. Twelve Data
is requested explicitly with split adjustment. Alpha Vantage raw daily prices
remain raw; its separately entitled adjusted endpoint includes dividend
adjustment. Raw/unknown adjustments do not produce adjusted-risk/factor metrics.
For Alpha adjusted histories, raw OHLC values are omitted rather than mixed with
the adjusted close.

Daily simple returns are `close[t] / close[t-1] - 1`. Annualized volatility is
sample standard deviation times `sqrt(252)`. Annualized historical return uses
`(last/first)^(252/observedIntervals)-1`. Drawdown is the greatest observed decline
from a previous peak. These are source-series measures, excluding unmodeled
fees/tax and, for split-only prices, dividend income. A drawdown observation is
not a future maximum loss.

The twelve-minus-one-month momentum convention is
`P(t-21)/P(t-252)-1`, requiring 253 closes. This excludes the latest 21 sessions and
measures the earlier 231 sessions, using a trading-session approximation. It is
inspired by the [Kenneth French prior 2–12 momentum construction](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_mom_factor_daily.html),
not a reproduction of that long-short portfolio. SMA50/SMA200 and shorter returns
also require their actual windows. Invalid, duplicated, future provider dates
and large daily-series gaps are rejected or cause metrics to be withheld.
Exchange calendar completeness is not independently certified.

`scoreFactors` compares a selected research cohort using percentile ranks and
average ties. Value uses positive earnings/book yield. Quality uses available
ROE, operating margin and inverse leverage, requiring two descriptors. Momentum
uses the excluded-month return; low volatility uses inverse observed risk. The
four components receive equal weight. Every component must have sufficient peers
and coverage before the composite is emitted; absent values stay null. Financial
periods must be known and within the stated 550-day policy window; history must
be within 14 days. These freshness thresholds are product policies.

[MSCI's quality overview](https://www.msci.com/indexes/group/quality-indexes)
describes profitability, earnings stability and leverage. Thesis does not claim
to replicate that index: earnings stability is missing from these lightweight
feeds, operating margin is an additional heuristic, and sectors/accounting
regimes can make cross-sectional comparisons misleading. No fitted prediction,
backtested alpha, fund endorsement or probability follows from the score.

## Recorded portfolio accounting

`calculatePortfolio` accepts explicit dated long-only buys/sells and fees in the
trade currency. It rejects oversells, duplicate transaction IDs, conflicting
currencies and oversized notionals. FIFO removes oldest lots; average cost
removes proportional pooled basis. Buy fees enter acquisition cost; sell fees
reduce proceeds. Realized P&L is net sale proceeds minus removed basis.
Unrealized P&L is current same-currency market value minus remaining basis.

Missing or stale quotes produce null valuation and incomplete coverage, rather
than a zero price. Currency totals remain separate. Concentration measures are
available only for completely priced currency groups: largest position fraction
and sum of squared position weights. These measures do not provide ETF holdings
look-through or credit/issuer diversification certification.

The ledger must be reconciled for broker history, splits, reinvestment, dividends,
transfers and taxes. It does not silently invent cash balances or corporate
transactions. Purchase-cost P&L is not time-weighted performance.

`computeTimeWeightedReturn` requires complete external flows and an observed
valuation immediately before every flow, plus opening/closing values in a single
currency. It geometrically links subperiod growth after removing the effect of
deposits/withdrawals. Missing flow history returns unavailable. This follows the
concept described by the [GIPS calculation handbook](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/);
no GIPS compliance is claimed. Correlation requires matching dated return
intervals, enough observations and a shared currency. It is withheld for unknown
adjustment, unmatched intervals or missing FX conversion.

## Conditional investment-plan allocation

`allocatePlan` conserves the input amount exactly in monetary cents. It separates
conditional instrument budgets from reserved cash and an explicitly manual bank
deposit category. Product rates, returns and deposit protection are unknown until
verified. Fixed-income funds still face market, duration and credit risk.

Candidates need verified source data, sufficient recent observations, valid
sector/risk metadata and risk measured in the plan's base currency. A foreign
listing with no actual aligned FX conversion cannot qualify. Missing market
slices are left reserved. Optional market weights are ceilings over the market
investment budget, excluding cash/deposit reserves. Position and sector caps are
fractions of the whole plan.

A principal-dependent goal within 24 months reserves all capital under the
conservative product policy. Other short/intermediate horizons limit the amount
exposed to market risk. Subjective high risk tolerance does not restore a
short-horizon capacity the goal cannot support. This is motivated by
[Investor.gov's horizon guidance](https://www.investor.gov/introduction-investing/investing-basics/save-and-invest/gauge-your-risk-tolerance)
and [Vanguard's cash-allocation research](https://corporate.vanguard.com/content/dam/corp/research/pdf/a_framework_for_allocating_to_cash.pdf),
not by a universal optimal-allocation rule.

Eligible instruments use capped inverse-volatility budgets. A conservative
observed sizing bound `sum(weight*assetVolatility)` scales exposure down when
necessary, avoiding assumptions about unknown correlations. Where at least sixty
common return dates exist, a historical estimate uses 50% off-diagonal covariance
shrinkage toward the diagonal. This is an explicit fixed heuristic, not the fitted
[Ledoit-Wolf estimator](https://ledoit.net/honey.pdf), and performs no covariance
inversion or return maximization. The estimate represents risk-asset contribution
under a flat nominal reserve assumption; bank default, inflation and liquidity
risk remain outside it. Observed risk constraints cannot guarantee future losses
or volatility.

## Provider contracts and access

`MarketDataClient` is a server-only BYOK adapter. It uses fixed provider hosts,
bounded JSON streaming, request deadlines and no automatic retries. Provider
quota/error envelopes are not accepted as successful observations. Per-user cache
keys include a credential fingerprint; credentials and raw provider error bodies
never become client output. The bounded local cache is single-flight and
best-effort; the server's persistent per-user cache/quota layer is needed across
Cloud Run instances.

- [Twelve Data documentation](https://twelvedata.com/docs) supports explicit daily
  adjustment and exchange-local dates. Statistics has a higher credit cost than
  quote/history. Its [pricing](https://twelvedata.com/pricing) distinguishes Basic
  non-display access from display plans. Review [the terms](https://twelvedata.com/terms)
  and exchange entitlements before charts or commercial use. The adapter does not
  assert company-news coverage for an unverified Twelve endpoint.
- [Alpha Vantage documentation](https://www.alphavantage.co/documentation/) separates
  compact raw history from full/adjusted premium history. Compact history alone
  cannot support twelve-minus-one-month momentum. Its [support page](https://www.alphavantage.co/support/)
  describes the free daily allowance; endpoint and real-time rights can differ.
- The [official Finnhub API specification](https://github.com/Finnhub-Stock-API/finnhub-go/blob/master/api/openapi.yaml)
  defines quote, candle, basic-financial, search and company-news fields. Company
  news is documented for North America; foreign coverage is not assumed. Candle
  access may need different entitlements. The adapter preserves unknown adjustment
  instead of certifying a risk series it cannot attest.
- [SEC public issuer metadata](https://www.sec.gov/files/company_tickers_exchange.json)
  supplements US discovery with company identity and listing exchange. It is not
  a quote feed and does not supply a market observation date. An operator contact
  is required; access/rate refusals are not bypassed.

The curated registry includes actual listing metadata and issuer references for
stocks and ETFs. It contains no financial metrics. ETF references include
[VTI](https://advisors.vanguard.com/investments/products/vti/vanguard-total-stock-market-etf),
[XLV](https://www.ssga.com/us/en/individual/etfs/state-street-health-care-select-sector-spdr-etf-xlv),
[XLK](https://www.ssga.com/us/en/individual/etfs/state-street-technology-select-sector-spdr-etf-xlk),
[SHY](https://www.ishares.com/us/products/239452/ishares-13-year-treasury-bond-etf) and
[Nifty 50 BeES](https://etf.nipponindiaim.com/Funds/details/14), with its
[NSE listing](https://www.nseindia.com/get-quote/equity/NIFTYBEES/Nippon-India-ETF-Nifty-50-BeES).
Issuer metadata does not grant brokerage access or provider data rights. Top-level sector caps do not establish ETF holdings look-through; overlapping fund/stock exposures need separate review.

Official public demonstration endpoints were probed only as reference contract
checks. Raw responses remain private and are never used as a production fallback.
Actual user-key entitlements, broader market coverage and commercial redistribution
remain separate validations.

## Personal display and hosted processing

The [Finnhub terms](https://finnhub.io/terms-of-service) restrict standard plans to
qualifying personal use, require written approval for business use or third-party
data/derived-result access, and require data deletion when the relevant
subscription ends. These terms do not explicitly authorize this application's
hosted BYOK processing or onward AI-provider processing. A personal key alone is
not evidence of those permissions.

The [Alpha Vantage terms](https://www.alphavantage.co/terms_of_service/) expressly
cover private individual investment research and personal noncommercial display
on user-controlled devices. Business use or providing access to other users is
classified separately and needs an agreement. The hosted service must establish
matching permissions rather than infer them from API success.

Provider-key settings therefore require appropriate entitlement acknowledgement.
The operator must verify applicable terms, display rights, hosted/AI processing
and retention for the intended use. No blanket commercial permission is claimed.
