import type { InstrumentRef } from './contracts';
import type { Market } from '../contracts';
export interface ResearchInstrument extends InstrumentRef {
    sector: string;
    assetType: 'equity' | 'equity_fund' | 'fixed_income_fund';
    metadataSource: string;
}
/** Discovery metadata only. No prices, valuation, signal or provider entitlement is implied. Foreign vendor symbols must be resolved by that vendor's search. */
export const researchUniverse: ResearchInstrument[] = [
    { symbol: 'VTI', name: 'Vanguard Morningstar Total Stock Market ETF', market: 'US', exchange: 'NYSE Arca', currency: 'USD', sector: 'Broad Market', assetType: 'equity_fund', metadataSource: 'https://advisors.vanguard.com/investments/products/vti/vanguard-total-stock-market-etf' },
    { symbol: 'XLV', name: 'State Street Health Care Select Sector SPDR ETF', market: 'US', exchange: 'NYSE Arca', currency: 'USD', sector: 'Healthcare', assetType: 'equity_fund', metadataSource: 'https://www.ssga.com/us/en/individual/etfs/state-street-health-care-select-sector-spdr-etf-xlv' },
    { symbol: 'XLK', name: 'State Street Technology Select Sector SPDR ETF', market: 'US', exchange: 'NYSE Arca', currency: 'USD', sector: 'Technology', assetType: 'equity_fund', metadataSource: 'https://www.ssga.com/us/en/individual/etfs/state-street-technology-select-sector-spdr-etf-xlk' },
    { symbol: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF', market: 'US', exchange: 'NASDAQ', currency: 'USD', sector: 'Government Bonds', assetType: 'fixed_income_fund', metadataSource: 'https://www.ishares.com/us/products/239452/ishares-13-year-treasury-bond-etf' },
    { symbol: 'NIFTYBEES', name: 'Nippon India ETF Nifty 50 BeES', market: 'India', exchange: 'NSE', currency: 'INR', sector: 'Broad Market', assetType: 'equity_fund', metadataSource: 'https://etf.nipponindiaim.com/Funds/details/14' },
    { symbol: 'AAPL', name: 'Apple', market: 'US', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', assetType: 'equity', metadataSource: 'https://investor.apple.com/' },
    { symbol: 'MSFT', name: 'Microsoft', market: 'US', exchange: 'NASDAQ', currency: 'USD', sector: 'Technology', assetType: 'equity', metadataSource: 'https://www.microsoft.com/en-us/Investor/' },
    { symbol: 'JNJ', name: 'Johnson & Johnson', market: 'US', exchange: 'NYSE', currency: 'USD', sector: 'Healthcare', assetType: 'equity', metadataSource: 'https://www.investor.jnj.com/' },
    { symbol: 'V', name: 'Visa', market: 'US', exchange: 'NYSE', currency: 'USD', sector: 'Financials', assetType: 'equity', metadataSource: 'https://investor.visa.com/' },
    { symbol: 'PG', name: 'Procter & Gamble', market: 'US', exchange: 'NYSE', currency: 'USD', sector: 'Consumer Staples', assetType: 'equity', metadataSource: 'https://www.pginvestor.com/' },
    { symbol: 'XOM', name: 'Exxon Mobil', market: 'US', exchange: 'NYSE', currency: 'USD', sector: 'Energy', assetType: 'equity', metadataSource: 'https://investor.exxonmobil.com/' },
    { symbol: 'RELIANCE', name: 'Reliance Industries', market: 'India', exchange: 'NSE', currency: 'INR', sector: 'Energy', assetType: 'equity', metadataSource: 'https://www.ril.com/investors' },
    { symbol: 'TCS', name: 'Tata Consultancy Services', market: 'India', exchange: 'NSE', currency: 'INR', sector: 'Technology', assetType: 'equity', metadataSource: 'https://www.tcs.com/who-we-are/investor-relations' },
    { symbol: 'INFY', name: 'Infosys', market: 'India', exchange: 'NSE', currency: 'INR', sector: 'Technology', assetType: 'equity', metadataSource: 'https://www.infosys.com/investors.html' },
    { symbol: 'HDFCBANK', name: 'HDFC Bank', market: 'India', exchange: 'NSE', currency: 'INR', sector: 'Financials', assetType: 'equity', metadataSource: 'https://www.hdfcbank.com/personal/about-us/investor-relations' },
    { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries', market: 'India', exchange: 'NSE', currency: 'INR', sector: 'Healthcare', assetType: 'equity', metadataSource: 'https://sunpharma.com/investors/' },
    { symbol: '0700', name: 'Tencent Holdings', market: 'China', exchange: 'HKEX', currency: 'HKD', sector: 'Communication Services', assetType: 'equity', metadataSource: 'https://www.tencent.com/en-us/investors.html' },
    { symbol: '9988', name: 'Alibaba Group', market: 'China', exchange: 'HKEX', currency: 'HKD', sector: 'Consumer Discretionary', assetType: 'equity', metadataSource: 'https://www.alibabagroup.com/en-US/ir-home' },
    { symbol: '0939', name: 'China Construction Bank', market: 'China', exchange: 'HKEX', currency: 'HKD', sector: 'Financials', assetType: 'equity', metadataSource: 'https://www.ccb.com/en/investorv3/corporateoverview/overview.html' },
    { symbol: '600519', name: 'Kweichow Moutai', market: 'China', exchange: 'SSE', currency: 'CNY', sector: 'Consumer Staples', assetType: 'equity', metadataSource: 'https://www.sse.com.cn/assortment/stock/list/info/company/index.shtml?COMPANY_CODE=600519' },
    { symbol: 'EMAAR', name: 'Emaar Properties', market: 'UAE', exchange: 'DFM', currency: 'AED', sector: 'Real Estate', assetType: 'equity', metadataSource: 'https://properties.emaar.com/en/investor-relations/' },
    { symbol: 'DEWA', name: 'Dubai Electricity and Water Authority', market: 'UAE', exchange: 'DFM', currency: 'AED', sector: 'Utilities', assetType: 'equity', metadataSource: 'https://www.dewa.gov.ae/en/investor-relations' },
    { symbol: 'FAB', name: 'First Abu Dhabi Bank', market: 'UAE', exchange: 'ADX', currency: 'AED', sector: 'Financials', assetType: 'equity', metadataSource: 'https://www.bankfab.com/en-ae/about-fab/investor-relations' },
    { symbol: 'ADNOCDIST', name: 'ADNOC Distribution', market: 'UAE', exchange: 'ADX', currency: 'AED', sector: 'Energy', assetType: 'equity', metadataSource: 'https://www.adnocdistribution.ae/en/investor-relations/' },
];
export function selectResearchUniverse(options: {
    markets?: Market[];
    sectors?: string[];
    limit?: number;
} = {}): ResearchInstrument[] { const selected = researchUniverse.filter(i => (!options.markets?.length || options.markets.includes(i.market)) && (!options.sectors?.length || options.sectors.includes('All') || options.sectors.includes(i.sector))); const limit = Math.max(1, Math.min(options.limit ?? 12, 40)); const ordered: ResearchInstrument[] = []; const queues = [...new Set(selected.map(i => i.market))].map(m => selected.filter(i => i.market === m)); while (ordered.length < limit && queues.some(q => q.length)) {
    for (const q of queues) {
        const next = q.shift();
        if (next && ordered.length < limit)
            ordered.push(next);
    }
} return ordered; }
