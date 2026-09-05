// Instrument lists for the FX board, the commodity board and the sector tracker.
// Every symbol here was checked against a live /batch-quote and a live
// /stock-price-change response.
//
// `currency` is not decoration. Wheat and corn trade in USX, meaning US cents,
// so a wheat print of 540 is $5.40 a bushel and not $540. FMP hands back the
// number without the unit, so the unit is carried here and shown beside every
// price.

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

  // Spot, not the futures contract. GCUSD and SIUSD are FMP's Gold Futures and
  // Silver Futures, and they read about 0.9% over spot on the basis, which is
  // real but is not the number anyone means by "the gold price": an analyst
  // checking it against Kitco or a search engine sees spot and reads the
  // difference as an error. Spot is also the live one here, where FMP delays
  // both metal futures by a flat ten minutes.
  //
  // Energy and the grains stay on futures below, because there the front
  // contract is the quoted reference and there is no competing spot print.
  { symbol: 'XAUUSD', label: 'Gold', group: 'Metals', currency: 'USD', unit: 'per troy oz, spot', decimals: 2 },
  { symbol: 'XAGUSD', label: 'Silver', group: 'Metals', currency: 'USD', unit: 'per troy oz, spot', decimals: 3 },
  { symbol: 'HGUSD', label: 'Copper', group: 'Metals', currency: 'USD', unit: 'per lb', decimals: 4 },

  { symbol: 'KEUSX', label: 'Wheat', group: 'Agriculture', currency: 'USX', unit: 'cents per bushel', decimals: 2 },
  { symbol: 'ZCUSX', label: 'Corn', group: 'Agriculture', currency: 'USX', unit: 'cents per bushel', decimals: 2 },
];

// Two sector boards, one ETF per sector on each, and the benchmark the
// relative column is measured against. Canada is the shorter board: the TSX
// sector funds cover six of the eleven GICS sectors, so a sector missing here
// is a fund that does not exist rather than a quote that failed.
//
// The two boards are not quoted in the same currency, so each carries its own.
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

const sectorBoard = (key) => SECTOR_BOARDS[String(key || 'us')] || null;

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

module.exports = { FX, COMMODITIES, SECTOR_BOARDS, SECTOR_SYMBOLS, sectorBoard, PERIODS };
