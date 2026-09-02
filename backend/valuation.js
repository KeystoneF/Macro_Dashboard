// Chart sources for the valuation panel.

// GuruFocus
const SHILLER = {
  id: 'shiller',
  label: 'Shiller PE ratio',
  source: 'GuruFocus',
  page: 'https://www.gurufocus.com/shiller-PE.php',
  // ratio, average and stamp are text inside the SVG
  url: 'https://chart.gurufocus.com/2095195182805983232.svg',
  type: 'image/svg+xml',
};

// Yardeni
const YARDENI_PAGE =
  'https://yardeni.com/charts/us-stock-market/stock-market-valuation/stock-market-p-e-ratios';

// the guid selects the chart, the chartname parameter is ignored
const gateway = (guid) =>
  `https://product.datastream.com/dscharting/gateway.aspx?guid=${guid}&action=REFRESH`;

// id, label, guid
const YARDENI = [
  ['sp-mag7-smid', 'Forward P/E: Mag-7, largecap and smidcap', 'b327e942-6779-4b1b-99de-ac9d514cb5b1'],
  ['sp500-forward', 'S&P 500 forward P/E, daily', '8b717704-eaf6-4227-8c3b-e0a3b2c6165c'],
  ['sp-indexes', 'Forward P/E across the S&P indexes', 'db616b6a-d9d5-4ab2-9a6a-0d719ee5a778'],
  ['sp500-vs-median', 'S&P 500 forward P/E against its median', 'defe2eb5-482a-4171-bf48-4a1105291995'],
  ['sp500-sectors', 'S&P 500 sector P/E, latest against year end', 'fe328dcf-093b-4c6d-b44d-2b0cc363efdb'],
  ['sp500-trailing', 'S&P 500 P/E, trailing and forward operating', '64c7ac85-c641-4201-ae5e-43d7dac21d49'],
  ['sp500-reported', 'S&P 500 P/E on trailing reported earnings', '4c55e3fe-14ed-4ed2-80d6-372b51760d58'],
  ['sp500-growth-value', 'S&P 500 forward P/E, growth against value', '789e3dfb-50b5-490a-b4e9-df87a8dc0d0b'],
  ['sp500-peg', 'S&P 500 PEG ratio', 'ea60ab07-67e6-4757-a24e-b298d19c9454'],
  ['russell-2000', 'Russell 2000 forward P/E', 'e5468409-7210-43c2-ad17-d4a4512ae400'],
  ['rule-of-20', 'Rule of 20', '492164ef-4b84-4460-919f-ae6e2990c8db'],
].map(([id, label, guid]) => ({
  id,
  label,
  source: 'Yardeni Research / LSEG Datastream',
  page: YARDENI_PAGE,
  url: gateway(guid),
  type: 'image/png',
}));

const byId = new Map([SHILLER, ...YARDENI].map((c) => [c.id, c]));

const chart = (id) => byId.get(String(id)) || null;

module.exports = { SHILLER, YARDENI, YARDENI_PAGE, chart };
