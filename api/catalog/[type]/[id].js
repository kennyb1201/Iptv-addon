const { getChannels } = require('../../../lib/m3u');
const { getEpgData } = require('../../../lib/epg');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const type = req.query.type;
    const id = (req.query.id || '').replace(/\.json$/, '');
    const extraRaw = (req.query.extra || '').replace(/\.json$/, '');
    const params = new URLSearchParams(extraRaw);
    const search = (params.get('search') || '').toLowerCase();
    const genre = params.get('genre');

    if (type !== 'tv' || id !== 'iptv_channels') {
      return res.status(200).json({ metas: [] });
    }

    const [channels, epg] = await Promise.all([getChannels(), getEpgData()]);
    let filtered = channels;
    if (genre) filtered = filtered.filter((c) => c.group === genre);
    if (search) filtered = filtered.filter((c) => c.name.toLowerCase().includes(search));

    const metas = filtered.map((c) => {
      const nowPlaying = epg && c.tvgId ? epg.channels[c.tvgId] : null;
      const currentTitle = nowPlaying && nowPlaying.current ? nowPlaying.current.title : null;
      return {
        id: c.id,
        type: 'tv',
        name: currentTitle ? `${c.name} — ${currentTitle}` : c.name,
        poster: c.logo || undefined,
        posterShape: 'square',
        background: c.logo || undefined,
        genres: [c.group]
      };
    });

    res.status(200).json({ metas });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};
