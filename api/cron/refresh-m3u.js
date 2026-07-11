const { refreshM3uCache } = require('../../lib/m3u');

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
    const validate = req.query.validate !== 'false';
    const result = await refreshM3uCache({ validate });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, err: err.message });
  }
};
