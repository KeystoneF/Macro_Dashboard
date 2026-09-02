// Curated rather than exposing every series either provider carries: Valet alone
// holds close to 16,000 and most are one-off chart series from a single
// publication. Every id below was checked against a live response and its last
// print confirmed current; anything that had stopped was dropped rather than
// listed.
//
// The OECD-sourced Canadian series on FRED are the trap worth naming.
// CANCPIALLMINMEI stopped in March 2025, CANPROINDMISMEI in February 2024 and
// CANPFCEQDSMEI in July 2023, while all three still resolve cleanly in the
// catalogue and look current. Canadian prices come from Valet for that reason.
//
// `group` drives the headings in the explorer's catalogue panel. File a series
// under what an analyst would look for it under, not under its provider's own
// taxonomy.

const CA = [
  // Valet carries the Bank's own CPI measures, which is why Canadian prices do
  // not come from FRED. All six are year-over-year percentage change already.
  ['STATIC_TOTALCPICHANGE', 'Prices', 'CPI, all items y/y', '%', 'Monthly'],
  ['STATIC_CORECPICHANGE', 'Prices', 'Core CPI y/y', '%', 'Monthly'],
  ['STATIC_CPIXFET', 'Prices', 'CPI ex food and energy y/y', '%', 'Monthly'],
  ['CPI_TRIM', 'Prices', 'CPI-trim y/y', '%', 'Monthly'],
  ['CPI_MEDIAN', 'Prices', 'CPI-median y/y', '%', 'Monthly'],
  ['CPI_COMMON', 'Prices', 'CPI-common y/y', '%', 'Monthly'],

  ['V39079', 'Policy', 'Policy rate target', '%', 'Daily'],
  ['AVG.INTWO', 'Policy', 'CORRA', '%', 'Daily'],

  ['BD.CDN.2YR.DQ.YLD', 'Bonds and bills', 'GoC 2-year benchmark', '%', 'Daily'],
  ['BD.CDN.3YR.DQ.YLD', 'Bonds and bills', 'GoC 3-year benchmark', '%', 'Daily'],
  ['BD.CDN.5YR.DQ.YLD', 'Bonds and bills', 'GoC 5-year benchmark', '%', 'Daily'],
  ['BD.CDN.7YR.DQ.YLD', 'Bonds and bills', 'GoC 7-year benchmark', '%', 'Daily'],
  ['BD.CDN.10YR.DQ.YLD', 'Bonds and bills', 'GoC 10-year benchmark', '%', 'Daily'],
  ['BD.CDN.LONG.DQ.YLD', 'Bonds and bills', 'GoC long-term benchmark', '%', 'Daily'],
  ['BD.CDN.RRB.DQ.YLD', 'Bonds and bills', 'Real return bond, long-term', '%', 'Daily'],
  // The bill series print on Tuesdays every second week, not weekly: checked
  // against Valet, every step in all three is 14 days. A biweekly line beside a
  // daily one is not a gap in either of them.
  ['V80691303', 'Bonds and bills', 'Treasury bill, 3 month', '%', 'Biweekly'],
  ['V80691304', 'Bonds and bills', 'Treasury bill, 6 month', '%', 'Biweekly'],
  ['V80691305', 'Bonds and bills', 'Treasury bill, 1 year', '%', 'Biweekly'],
  ['STATIC_ATABLE_V122544_V122553', 'Bonds and bills', 'Conventional minus real return spread', '%', 'Monthly'],

  ['FXUSDCAD', 'FX', 'USD/CAD', 'CAD per USD', 'Daily'],
  ['FXEURCAD', 'FX', 'EUR/CAD', 'CAD per EUR', 'Daily'],
  ['FXGBPCAD', 'FX', 'GBP/CAD', 'CAD per GBP', 'Daily'],
  ['FXJPYCAD', 'FX', 'JPY/CAD', 'CAD per JPY', 'Daily'],
  ['FXAUDCAD', 'FX', 'AUD/CAD', 'CAD per AUD', 'Daily'],
  ['FXCHFCAD', 'FX', 'CHF/CAD', 'CAD per CHF', 'Daily'],
  ['FXCNYCAD', 'FX', 'CNY/CAD', 'CAD per CNY', 'Daily'],
  ['FXMXNCAD', 'FX', 'MXN/CAD', 'CAD per MXN', 'Daily'],
  ['CEER_BROADN', 'FX', 'Effective exchange rate, broad', 'Index 1992=100', 'Daily'],
  ['CEER_BROADN_XUS', 'FX', 'Effective exchange rate ex USD', 'Index 1992=100', 'Daily'],

  ['M.BCPI', 'Commodities', 'Commodity price index, total', 'Index 1972=100', 'Monthly'],
  ['M.BCNE', 'Commodities', 'Commodity price index ex energy', 'Index 1972=100', 'Monthly'],
  ['M.ENER', 'Commodities', 'Commodity price index, energy', 'Index 1972=100', 'Monthly'],
  ['M.MTLS', 'Commodities', 'Commodity price index, metals', 'Index 1972=100', 'Monthly'],
  ['M.AGRI', 'Commodities', 'Commodity price index, agriculture', 'Index 1972=100', 'Monthly'],
  ['M.FOPR', 'Commodities', 'Commodity price index, forestry', 'Index 1972=100', 'Monthly'],
  ['M.FISH', 'Commodities', 'Commodity price index, fish', 'Index 1972=100', 'Monthly'],

  ['STATIC_ATABLE_V37151', 'Money and wages', 'M1+ growth y/y', '%', 'Monthly'],
  ['STATIC_ATABLE_V41552801', 'Money and wages', 'M2++ growth y/y', '%', 'Monthly'],
  ['STATIC_ATABLE_V35014A', 'Money and wages', 'Average hourly earnings, LFS y/y', '%', 'Monthly'],
  ['STATIC_ATABLE_BL800502', 'Money and wages', 'Average hourly earnings, SEPH y/y', '%', 'Monthly'],
];

// Canadian series that do come from FRED, both checked as still printing.
const CA_FRED = [
  ['LRUNTTTTCAM156S', 'Labour and output', 'Unemployment rate, OECD basis', '%', 'Monthly'],
  ['NGDPRSAXDCCAQ', 'Labour and output', 'Real GDP, quarterly', 'Mil. CAD', 'Quarterly'],
];

// Statistics Canada, via the Web Data Service. This is the national statistical
// office, so it carries the real activity series Valet does not: GDP by month,
// the labour force survey, retail and manufacturing, trade and housing starts.
//
// The units below are the trap. StatCan publishes a value alongside a scalar
// factor, and the value is expressed IN that factor rather than multiplied
// through by it: employment prints as 21214.8 with a scalar of thousands, not
// as 21,214,800. Reading the number without the factor is wrong by three or six
// orders of magnitude and still looks like a plausible figure, so the scale is
// carried in the units string here and the published value is shown untouched.
const CA_STATCAN = [
  ['v41690973', 'Prices', 'CPI, all items index', 'Index 2002=100', 'Monthly'],

  ['v2062815', 'Labour and output', 'Unemployment rate, LFS', '%', 'Monthly'],
  ['v2062816', 'Labour and output', 'Participation rate', '%', 'Monthly'],
  ['v2062811', 'Labour and output', 'Employment', 'Thousands of persons', 'Monthly'],
  ['v2062810', 'Labour and output', 'Labour force', 'Thousands of persons', 'Monthly'],
  ['v2062814', 'Labour and output', 'Unemployment level', 'Thousands of persons', 'Monthly'],
  ['v65201210', 'Labour and output', 'GDP at basic prices, monthly', 'Mil. chained 2017 $', 'Monthly'],
  ['v1', 'Labour and output', 'Population', 'Persons', 'Quarterly'],

  ['v1446859483', 'Trade and industry', 'Retail sales', 'Thousands of $', 'Monthly'],
  ['v800450', 'Trade and industry', 'Manufacturing sales', 'Thousands of $', 'Monthly'],
  ['v800913', 'Trade and industry', 'Manufacturing new orders', 'Thousands of $', 'Monthly'],
  ['v729949', 'Trade and industry', 'Housing starts', 'Units', 'Monthly'],
  ['v87008984', 'Trade and industry', 'Merchandise trade balance', 'Mil. $', 'Monthly'],
  ['v87008955', 'Trade and industry', 'Merchandise exports', 'Mil. $', 'Monthly'],
];

const US = [
  ['CPIAUCSL', 'Prices', 'CPI, all items', 'Index 1982-84=100', 'Monthly'],
  ['CPILFESL', 'Prices', 'CPI, core', 'Index 1982-84=100', 'Monthly'],
  ['PCEPI', 'Prices', 'PCE price index', 'Index 2017=100', 'Monthly'],
  ['PCEPILFE', 'Prices', 'PCE price index, core', 'Index 2017=100', 'Monthly'],
  ['PPIACO', 'Prices', 'PPI, all commodities', 'Index 1982=100', 'Monthly'],
  ['PPIFIS', 'Prices', 'PPI, final demand', 'Index Nov 2009=100', 'Monthly'],
  ['T5YIE', 'Prices', '5-year breakeven inflation', '%', 'Daily'],
  ['T10YIE', 'Prices', '10-year breakeven inflation', '%', 'Daily'],
  ['T5YIFR', 'Prices', '5-year 5-year forward inflation', '%', 'Daily'],
  ['MICH', 'Prices', 'Michigan inflation expectation', '%', 'Monthly'],

  ['UNRATE', 'Labour', 'Unemployment rate', '%', 'Monthly'],
  ['U6RATE', 'Labour', 'Unemployment rate, U-6', '%', 'Monthly'],
  ['PAYEMS', 'Labour', 'Nonfarm payrolls', 'Thousands', 'Monthly'],
  ['ICSA', 'Labour', 'Initial jobless claims', 'Persons', 'Weekly'],
  ['CCSA', 'Labour', 'Continued claims', 'Persons', 'Weekly'],
  ['CIVPART', 'Labour', 'Labour force participation', '%', 'Monthly'],
  ['EMRATIO', 'Labour', 'Employment to population', '%', 'Monthly'],
  ['CES0500000003', 'Labour', 'Average hourly earnings', '$ per hour', 'Monthly'],
  ['JTSJOL', 'Labour', 'Job openings', 'Thousands', 'Monthly'],
  ['AWHAETP', 'Labour', 'Average weekly hours', 'Hours', 'Monthly'],

  ['GDPC1', 'Activity', 'Real GDP', 'Bil. chained 2017 $', 'Quarterly'],
  ['GDP', 'Activity', 'Nominal GDP', 'Bil. $', 'Quarterly'],
  ['A191RL1Q225SBEA', 'Activity', 'Real GDP, q/q annualised', '%', 'Quarterly'],
  ['INDPRO', 'Activity', 'Industrial production', 'Index 2017=100', 'Monthly'],
  ['TCU', 'Activity', 'Capacity utilisation', '%', 'Monthly'],
  ['RSAFS', 'Activity', 'Retail sales incl. food services', 'Mil. $', 'Monthly'],
  ['RSXFS', 'Activity', 'Retail sales, retail trade', 'Mil. $', 'Monthly'],
  ['DGORDER', 'Activity', 'Durable goods orders', 'Mil. $', 'Monthly'],
  ['PCEC96', 'Activity', 'Real consumer spending', 'Bil. chained 2017 $', 'Monthly'],
  ['DSPIC96', 'Activity', 'Real disposable income', 'Bil. chained 2017 $', 'Monthly'],
  ['PSAVERT', 'Activity', 'Personal saving rate', '%', 'Monthly'],
  ['UMCSENT', 'Activity', 'Michigan consumer sentiment', 'Index 1966Q1=100', 'Monthly'],

  ['HOUST', 'Housing', 'Housing starts', 'Thousands of units', 'Monthly'],
  ['PERMIT', 'Housing', 'Building permits', 'Thousands of units', 'Monthly'],
  ['EXHOSLUSM495S', 'Housing', 'Existing home sales', 'Units', 'Monthly'],
  ['MSPUS', 'Housing', 'Median new home sale price', '$', 'Quarterly'],
  ['CSUSHPINSA', 'Housing', 'Case-Shiller national home price', 'Index Jan 2000=100', 'Monthly'],
  ['MORTGAGE30US', 'Housing', '30-year fixed mortgage rate', '%', 'Weekly'],

  ['FEDFUNDS', 'Rates', 'Fed funds effective, monthly', '%', 'Monthly'],
  ['DFF', 'Rates', 'Fed funds effective, daily', '%', 'Daily'],
  ['EFFR', 'Rates', 'Effective fed funds rate', '%', 'Daily'],
  ['SOFR', 'Rates', 'SOFR', '%', 'Daily'],
  ['DGS1MO', 'Rates', 'Treasury 1-month', '%', 'Daily'],
  ['DGS3MO', 'Rates', 'Treasury 3-month', '%', 'Daily'],
  ['DGS6MO', 'Rates', 'Treasury 6-month', '%', 'Daily'],
  ['DGS1', 'Rates', 'Treasury 1-year', '%', 'Daily'],
  ['DGS2', 'Rates', 'Treasury 2-year', '%', 'Daily'],
  ['DGS3', 'Rates', 'Treasury 3-year', '%', 'Daily'],
  ['DGS5', 'Rates', 'Treasury 5-year', '%', 'Daily'],
  ['DGS7', 'Rates', 'Treasury 7-year', '%', 'Daily'],
  ['DGS10', 'Rates', 'Treasury 10-year', '%', 'Daily'],
  ['DGS20', 'Rates', 'Treasury 20-year', '%', 'Daily'],
  ['DGS30', 'Rates', 'Treasury 30-year', '%', 'Daily'],
  ['T10Y2Y', 'Rates', '10-year minus 2-year', '%', 'Daily'],
  ['T10Y3M', 'Rates', '10-year minus 3-month', '%', 'Daily'],
  ['DFII10', 'Rates', 'Treasury 10-year real yield', '%', 'Daily'],

  ['BAMLH0A0HYM2', 'Credit', 'High yield spread', '%', 'Daily'],
  ['BAMLC0A0CM', 'Credit', 'Investment grade spread', '%', 'Daily'],
  ['AAA', 'Credit', 'Moody\'s Aaa corporate yield', '%', 'Monthly'],
  ['BAA', 'Credit', 'Moody\'s Baa corporate yield', '%', 'Monthly'],

  ['M2SL', 'Money', 'M2 money stock', 'Bil. $', 'Monthly'],
  ['M1SL', 'Money', 'M1 money stock', 'Bil. $', 'Monthly'],
  ['BOGMBASE', 'Money', 'Monetary base', 'Bil. $', 'Monthly'],
  ['WALCL', 'Money', 'Fed total assets', 'Mil. $', 'Weekly'],
  ['TOTALSL', 'Money', 'Consumer credit outstanding', 'Mil. $', 'Monthly'],
  ['BUSLOANS', 'Money', 'Commercial and industrial loans', 'Bil. $', 'Monthly'],

  ['VIXCLS', 'Markets', 'VIX', 'Index', 'Daily'],
  ['SP500', 'Markets', 'S&P 500', 'Index', 'Daily'],
  ['NASDAQCOM', 'Markets', 'NASDAQ Composite', 'Index', 'Daily'],
  ['DJIA', 'Markets', 'Dow Jones Industrial Average', 'Index', 'Daily'],
  ['DTWEXBGS', 'Markets', 'Broad dollar index', 'Index Jan 2006=100', 'Daily'],
  ['DCOILWTICO', 'Markets', 'WTI crude', '$ per barrel', 'Daily'],
  ['DCOILBRENTEU', 'Markets', 'Brent crude', '$ per barrel', 'Daily'],
  ['DHHNGSP', 'Markets', 'Henry Hub natural gas', '$ per mil. BTU', 'Daily'],

  ['GFDEBTN', 'Fiscal and trade', 'Federal public debt', 'Mil. $', 'Quarterly'],
  ['MTSDS133FMS', 'Fiscal and trade', 'Federal surplus or deficit', 'Mil. $', 'Monthly'],
  ['BOPGSTB', 'Fiscal and trade', 'Trade balance, goods and services', 'Mil. $', 'Monthly'],
];

const expand = (rows, src, country) =>
  rows.map(([id, group, label, units, freq]) => ({ id, src, country, group, label, units, freq }));

module.exports = [
  ...expand(CA, 'boc', 'CA'),
  ...expand(CA_STATCAN, 'statcan', 'CA'),
  ...expand(CA_FRED, 'fred', 'CA'),
  ...expand(US, 'fred', 'US'),
];
