const { refreshM3uCache } = require('../../lib/m3u');
const { refreshEpg } = require('../../lib/epg');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const expected = process.env.CRON_SECRET;
  const provided =
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') ||
    req.query.secret;

  if (expected && provided !== expected) {
    return res.status(401).json({ err: 'Unauthorized' });
  }

  const target = req.query.target || 'all';
  const validate = req.query.validate !== 'false';

  const result = { ok: true };

  try {
    if (target === 'm3u' || target === 'all') {
      result.m3u = await refreshM3uCache({ validate });
    }
    if (target === 'epg' || target === 'all') {
      result.epg = await refreshEpg();
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, err: err.message });
  }
};
