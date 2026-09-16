const router = require('express').Router();
const service = require('../watchlists');
const { isoDate } = require('../providers');
const { row } = require('../csv');
const { fail } = require('../redact');

const COLUMNS = {
  companies: ['symbol', 'name', 'country', 'price', 'day', 'week', 'month', 'ytd', 'year', 'quotedAt', 'period', 'revenue', 'eps'],
  news: ['published', 'symbol', 'company', 'title', 'category', 'region', 'exchange', 'publisher', 'url'],
  earnings: ['date', 'symbol', 'name', 'epsEstimated', 'epsActual', 'revenueEstimated', 'lastUpdated'],
  calendar: ['date', 'country', 'event', 'impact', 'unit', 'actual', 'estimate', 'previous'],
};
const LABELS = { day: '1D (%)', week: '1W (%)', month: '1M (%)', ytd: 'YTD (%)', year: '1Y (%)', quotedAt: 'Quote time (UTC)', period: 'Financial period', price: 'Price (listing currency)', revenue: 'Revenue (reported currency)', eps: 'EPS (reported currency)' };

function respond(req, res, kind, data) {
  if (req.query.format !== 'csv') return res.json(data);
  const keys = COLUMNS[kind];
  const csv = [row(keys.map((k) => LABELS[k] || k)), ...data.rows.map((r) => row(keys.map((k) => r[k])))].join('\r\n');
  res.type('text/csv').attachment(`watchlist-${kind}.csv`).send('\uFEFF' + csv);
}

router.use((req, res, next) => {
  if (Object.values(req.query).some((v) => typeof v !== 'string' || v.length > 200)) return res.status(400).json({ error: 'Invalid filter value.' });
  if (req.query.page && (!/^[1-9]\d{0,5}$/.test(req.query.page))) return res.status(400).json({ error: 'Invalid page.' });
  if (req.query.format && !['csv', 'json'].includes(req.query.format)) return res.status(400).json({ error: 'Invalid download format.' });
  for (const key of ['from', 'to']) if (req.query[key] && !isoDate(req.query[key])) return res.status(400).json({ error: 'Use a valid YYYY-MM-DD date.' });
  if (req.query.from && req.query.to && req.query.from > req.query.to) return res.status(400).json({ error: 'Start date must precede end date.' });
  next();
});

router.get('/', async (req, res) => {
  try { res.json(await service.lists()); } catch (err) { fail(res, err); }
});

router.get('/calendar', async (req, res) => {
  const from = req.query.from || service.today();
  const to = req.query.to || service.offset(from, 6);
  if (from > to || Date.parse(to) - Date.parse(from) > 31 * 864e5) return res.status(400).json({ error: 'Select a calendar range of up to 31 days.' });
  if (req.query.country && !['all', 'CA', 'US'].includes(req.query.country)) return res.status(400).json({ error: 'Select Canada, United States, or both.' });
  try { respond(req, res, 'calendar', await service.calendar({ ...req.query, from, to })); } catch (err) { fail(res, err); }
});

router.param('id', (req, res, next, id) => {
  if (!/^[1-9]\d{0,9}$/.test(id)) return res.status(400).json({ error: 'Invalid watchlist ID.' });
  next();
});

router.get('/:id/companies', async (req, res) => {
  if (req.query.report && !['annual', 'quarter', 'ttm'].includes(req.query.report)) return res.status(400).json({ error: 'Invalid financial period.' });
  try { respond(req, res, 'companies', await service.companies(req.params.id, { ...req.query, page: Number(req.query.page || 1) })); } catch (err) { fail(res, err); }
});
router.get('/:id/filters', async (req, res) => {
  try { res.json(await service.filters(req.params.id)); } catch (err) { fail(res, err); }
});
router.get('/:id/news', async (req, res) => {
  if (req.query.company && !/^[1-9]\d{0,9}$/.test(req.query.company)) return res.status(400).json({ error: 'Invalid company filter.' });
  try { respond(req, res, 'news', await service.news(req.params.id, req.query)); } catch (err) { fail(res, err); }
});
router.get('/:id/earnings', async (req, res) => {
  const days = Number(req.query.days || 30);
  if (![7, 30, 90].includes(days)) return res.status(400).json({ error: 'Select 7, 30, or 90 days.' });
  try { respond(req, res, 'earnings', await service.earnings(req.params.id, days)); } catch (err) { fail(res, err); }
});

module.exports = router;
