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

  try {
    const result = await refreshEpg();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, err: err.message });
  }
};
