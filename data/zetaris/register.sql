-- Thesis: three independent source feeds federated in the required Zetaris layer.
-- PREPARED SQL, not a claim of live execution. Execute one statement per request.
-- Stage the exported files inside the actual Zetaris driver first; replace file
-- locations only if the operator's deployment uses a different mounted path.
-- All rows below are synthetic. A real query is not real-market-data proof.
-- Inspect existing objects before running; do not replace another deployment.
CREATE LIGHTNING DATABASE thesis_prices DESCRIBE BY 'Synthetic daily adjusted price paths and listing identities';
CREATE LIGHTNING DATABASE thesis_fundamentals DESCRIBE BY 'Synthetic company financial input feed';
CREATE LIGHTNING DATABASE thesis_filings DESCRIBE BY 'Research provenance and source discovery references';
CREATE LIGHTNING FILESTORE TABLE records FROM thesis_prices FORMAT JSON OPTIONS (path '/home/zetaris/customer-data/shared/thesis/prices.json');
CREATE LIGHTNING FILESTORE TABLE records FROM thesis_fundamentals FORMAT CSV OPTIONS (path '/home/zetaris/customer-data/shared/thesis/fundamentals.csv', header 'true', quote '"', escape '"');
CREATE LIGHTNING FILESTORE TABLE records FROM thesis_filings FORMAT JSON OPTIONS (path '/home/zetaris/customer-data/shared/thesis/filings.json');
CREATE SCHEMASTORE CONTAINER thesis;
CREATE SCHEMASTORE VIEW research_universe WITH CONTAINER thesis AS
SELECT p.symbol AS symbol,
       f.name AS name,
       p.market AS market,
       p.exchange AS exchange,
       p.currency AS currency,
       f.sector AS sector,
       CAST(p.price AS DOUBLE) AS price,
       CAST(p.annual_return AS DOUBLE) AS annualReturn,
       CAST(p.annual_volatility AS DOUBLE) AS annualVolatility,
       CAST(p.max_drawdown AS DOUBLE) AS maxDrawdown,
       CAST(f.revenue_growth AS DOUBLE) AS revenueGrowth,
       CAST(f.operating_margin AS DOUBLE) AS operatingMargin,
       CAST(f.debt_to_equity AS DOUBLE) AS debtToEquity,
       CAST(f.pe AS DOUBLE) AS pe,
       CAST(f.dividend_yield AS DOUBLE) AS dividendYield,
       CAST(f.market_cap_bn AS DOUBLE) AS marketCapBn,
       CAST(f.quality AS DOUBLE) AS quality,
       p.prices_json AS prices,
       e.evidence_json AS evidence,
       f.catalyst AS catalyst,
       f.risk AS risk,
       f.thesis AS thesis,
       p.as_of AS asOf
FROM thesis_prices.records p
LEFT JOIN thesis_fundamentals.records f
  ON p.symbol = f.symbol AND p.market = f.market AND p.as_of = f.as_of
LEFT JOIN thesis_filings.records e
  ON p.symbol = e.symbol AND p.market = e.market AND p.as_of = e.as_of;
