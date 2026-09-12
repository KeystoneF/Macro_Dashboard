// Symbols and display units for the market boards.
// USX means US cents; keep it distinct from USD.

const FX = [
  { symbol: 'EURUSD', label: 'EUR/USD', group: 'Majors', currency: 'USD', decimals: 4 },
  { symbol: 'GBPUSD', label: 'GBP/USD', group: 'Majors', currency: 'USD', decimals: 4 },
  { symbol: 'USDJPY', label: 'USD/JPY', group: 'Majors', currency: 'JPY', decimals: 3 },
  { symbol: 'AUDUSD', label: 'AUD/USD', group: 'Majors', currency: 'USD', decimals: 4 },
  { symbol: 'USDCHF', label: 'USD/CHF', group: 'Majors', currency: 'CHF', decimals: 4 },

  { symbol: 'USDCAD', label: 'USD/CAD', group: 'CAD crosses', currency: 'CAD', decimals: 4 },
  { symbol: 'EURCAD', label: 'EUR/CAD', group: 'CAD crosses', currency: 'CAD', decimals: 4 },
  { symbol: 'GBPCAD', label: 'GBP/CAD', group: 'CAD crosses', currency: 'CAD', decimals: 4 },
  { symbol: 'CADJPY', label: 'CAD/JPY', group: 'CAD crosses', currency: 'JPY', decimals: 3 },
  { symbol: 'AUDCAD', label: 'AUD/CAD', group: 'CAD crosses', currency: 'CAD', decimals: 4 },
];

const COMMODITIES = [
  { symbol: 'CLUSD', label: 'WTI crude', group: 'Energy', currency: 'USD', unit: 'per barrel', decimals: 2 },
  { symbol: 'BZUSD', label: 'Brent crude', group: 'Energy', currency: 'USD', unit: 'per barrel', decimals: 2 },
  { symbol: 'NGUSD', label: 'Natural gas', group: 'Energy', currency: 'USD', unit: 'per MMBtu', decimals: 3 },

  // Use spot symbols for gold and silver. Other commodities use the provider's contracts.
  { symbol: 'XAUUSD', label: 'Gold', group: 'Metals', currency: 'USD', unit: 'per troy oz, spot', decimals: 2 },
  { symbol: 'XAGUSD', label: 'Silver', group: 'Metals', currency: 'USD', unit: 'per troy oz, spot', decimals: 3 },
  { symbol: 'HGUSD', label: 'Copper', group: 'Metals', currency: 'USD', unit: 'per lb', decimals: 4 },

  { symbol: 'KEUSX', label: 'Wheat', group: 'Agriculture', currency: 'USX', unit: 'cents per bushel', decimals: 2 },
  { symbol: 'ZCUSX', label: 'Corn', group: 'Agriculture', currency: 'USX', unit: 'cents per bushel', decimals: 2 },
];

// Brief benchmarks are tracking ETFs; this plan does not quote the indices.
const BRIEF = [
  { symbol: 'XIC.TO', label: 'S&P/TSX Composite, XIC fund', group: 'Equity', currency: 'CAD', decimals: 2 },
  { symbol: 'SPY', label: 'S&P 500, SPY fund', group: 'Equity', currency: 'USD', decimals: 2 },
  { symbol: 'USDCAD', label: 'USD/CAD', group: 'FX', currency: 'CAD', decimals: 4 },
  { symbol: 'CLUSD', label: 'WTI crude', group: 'Commodities', currency: 'USD', unit: 'per barrel', decimals: 2 },
  { symbol: 'XAUUSD', label: 'Gold', group: 'Commodities', currency: 'USD', unit: 'per troy oz, spot', decimals: 2 },
];

// Sector ETFs and their benchmarks. Canadian funds cover six sectors.
const SECTOR_BOARDS = {
  us: {
    key: 'us',
    label: 'United States',
    currency: 'USD',
    // the State Street line-up named in the design doc
    benchmark: { symbol: 'SPY', label: 'S&P 500' },
    sectors: [
      { symbol: 'XLK', label: 'Technology' },
      { symbol: 'XLF', label: 'Financials' },
      { symbol: 'XLE', label: 'Energy' },
      { symbol: 'XLV', label: 'Health Care' },
      { symbol: 'XLI', label: 'Industrials' },
      { symbol: 'XLY', label: 'Consumer Discretionary' },
      { symbol: 'XLP', label: 'Consumer Staples' },
      { symbol: 'XLU', label: 'Utilities' },
      { symbol: 'XLB', label: 'Materials' },
      { symbol: 'XLRE', label: 'Real Estate' },
      { symbol: 'XLC', label: 'Communication Services' },
    ],
  },
  ca: {
    key: 'ca',
    label: 'Canada',
    currency: 'CAD',
    // XIU tracks the S&P/TSX 60, not the Composite, and is labelled as what it is
    benchmark: { symbol: 'XIU.TO', label: 'S&P/TSX 60' },
    sectors: [
      { symbol: 'XEG.TO', label: 'Energy' },
      { symbol: 'XIT.TO', label: 'Information Technology' },
      { symbol: 'XMA.TO', label: 'Materials' },
      { symbol: 'XFN.TO', label: 'Financials' },
      { symbol: 'XRE.TO', label: 'Real Estate' },
      { symbol: 'XUT.TO', label: 'Utilities' },
    ],
  },
};

const sectorBoard = (key = 'us') => Object.hasOwn(SECTOR_BOARDS, key || 'us') ? SECTOR_BOARDS[key || 'us'] : null;

// every symbol either board draws, for the routes that need one flat list
const SECTOR_SYMBOLS = Object.values(SECTOR_BOARDS).flatMap((b) => [...b.sectors, b.benchmark]);

// The board's period buttons on the left, the key FMP answers with on the right.
// Its "5D" is the week, and ytd is lowercase where every other key is not.
const PERIODS = [
  { key: '1D', field: '1D' },
  { key: '1W', field: '5D' },
  { key: '1M', field: '1M' },
  { key: '3M', field: '3M' },
  { key: 'YTD', field: 'ytd' },
  { key: '1Y', field: '1Y' },
];

module.exports = { FX, COMMODITIES, BRIEF, SECTOR_BOARDS, SECTOR_SYMBOLS, sectorBoard, PERIODS };
