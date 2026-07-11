const { getChannels } = require('../../lib/m3u');
const { getEpgData } = require('../../lib/epg');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const id = (req.query.id || '').replace(/\.json$/, '');

    const [channels, epg] = await Promise.all([getChannels(), getEpgData()]);
    const ch = channels.find((c) => c.id === id);
    if (!ch) {
      return res.status(200).json({ channel: null, programmes: [] });
    }

    const data = epg && ch.tvgId ? epg.channels[ch.tvgId] : null;

    res.status(200).json({
      channel: { id: ch.id, name: ch.name, group: ch.group },
      generatedAt: epg ? epg.generatedAt : null,
      windowHours: epg ? epg.windowHours : null,
      programmes: data ? data.upcoming : []
    });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};
