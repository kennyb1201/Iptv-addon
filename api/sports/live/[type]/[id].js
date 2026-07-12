const { getChannels } = require('../../../../lib/m3u');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

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

    const multi = ch.sources.length > 1;
    const streams = ch.sources.map((src, i) => {
      const s = { url: src.url, title: multi ? `${ch.name} (Source ${i + 1})` : ch.name };
      const ua = src.userAgent || process.env.STREAM_USER_AGENT;
      if (ua) {
        s.behaviorHints = { proxyHeaders: { request: { 'User-Agent': ua } } };
      }
      return s;
    });

    res.status(200).json({ streams });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};
