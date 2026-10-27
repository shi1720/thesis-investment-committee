-- Retain actual server responses for these queries as integration evidence.
-- Expected fixture counts are 20 / 20 / 20 / 20; expected counts are not proof.
SELECT 'prices' AS source, COUNT(*) AS record_count FROM thesis_prices.records;
SELECT 'fundamentals' AS source, COUNT(*) AS record_count FROM thesis_fundamentals.records;
SELECT 'filings' AS source, COUNT(*) AS record_count FROM thesis_filings.records;
SELECT market, COUNT(*) AS record_count FROM thesis.research_universe GROUP BY market ORDER BY market;
SELECT symbol, market, sector, annualVolatility, maxDrawdown FROM thesis.research_universe ORDER BY market, symbol;
-- Missing joined data must remain visible and fail the typed adapter, not disappear.
SELECT symbol, market FROM thesis.research_universe WHERE name IS NULL OR evidence IS NULL OR prices IS NULL;
-- The product issues the same bounded read-only SELECT through its Zetaris adapter.
SELECT * FROM thesis.research_universe WHERE market IN ('US', 'India') LIMIT 1000;
