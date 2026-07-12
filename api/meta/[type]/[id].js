const { getChannels, posterFor } = require('../../../lib/m3u');
const { getEpgData } = require('../../../lib/epg');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    const type = req.query.type;
    const id = (req.query.id || '').replace(/\.json$/, '');

    if (type !== 'tv') {
      return res.status(200).json({ meta: null });
    }

    const [channels, epg] = await Promise.all([getChannels(), getEpgData()]);
    const ch = channels.find((c) => c.id === id);
    if (!ch) {
      return res.status(200).json({ meta: null });
    }

    const nowPlaying = epg && ch.tvgId ? epg.channels[ch.tvgId] : null;
    let description = ch.group;
    if (nowPlaying && nowPlaying.current) {
      description += `\nNow: ${nowPlaying.current.title}`;
    }
    if (nowPlaying && nowPlaying.next) {
      description += `\nNext: ${nowPlaying.next.title}`;
    }

    const poster = posterFor(ch);
    res.status(200).json({
      meta: {
        id: ch.id,
        type: 'tv',
        name: ch.name,
        poster,
        posterShape: 'square',
        background: poster,
        genres: [ch.group],
        description
      }
    });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};
