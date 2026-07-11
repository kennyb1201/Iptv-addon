const { getChannels } = require('../../../lib/m3u');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const type = req.query.type;
    const id = (req.query.id || '').replace(/\.json$/, '');

    if (type !== 'tv') {
      return res.status(200).json({ streams: [] });
    }

    const channels = await getChannels();
    const ch = channels.find((c) => c.id === id);
    if (!ch) {
      return res.status(200).json({ streams: [] });
    }

    const stream = { url: ch.url, title: ch.name };

    const ua = ch.userAgent || process.env.STREAM_USER_AGENT;
    if (ua) {
      stream.behaviorHints = { proxyHeaders: { request: { 'User-Agent': ua } } };
    }

    res.status(200).json({ streams: [stream] });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};
