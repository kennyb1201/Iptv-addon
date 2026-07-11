const { getChannels, posterFor, slugify } = require('../../../lib/m3u');
const { getEpgData } = require('../../../lib/epg');

const PAGE_SIZE = 100;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const type = req.query.type;
    const id = (req.query.id || '').replace(/\.json$/, '');
    const extraRaw = (req.query.extra || '').replace(/\.json$/, '');
    const params = new URLSearchParams(extraRaw);
    const search = (params.get('search') || '').toLowerCase();
    const skip = parseInt(params.get('skip') || '0', 10) || 0;

    if (type !== 'tv') {
      return res.status(200).json({ metas: [] });
    }

    const [channels, epg] = await Promise.all([getChannels(), getEpgData()]);

    let filtered;
    if (id === 'iptv_channels') {
      filtered = channels;
    } else if (id === 'iptv_search') {
      filtered = search ? channels : [];
    } else if (id.startsWith('iptv_genre_')) {
      const genreSlug = id.slice('iptv_genre_'.length);
      filtered = channels.filter((c) => slugify(c.group) === genreSlug);
    } else {
      return res.status(200).json({ metas: [] });
    }

    if (search) {
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(search));
    }

    const page = filtered.slice(skip, skip + PAGE_SIZE);

    const metas = page.map((c) => {
      const nowPlaying = epg && c.tvgId ? epg.channels[c.tvgId] : null;
      const currentTitle = nowPlaying && nowPlaying.current ? nowPlaying.current.title : null;
      return {
        id: c.id,
        type: 'tv',
        name: currentTitle ? `${c.name} — ${currentTitle}` : c.name,
        poster: posterFor(c),
        posterShape: 'square',
        background: posterFor(c),
        genres: [c.group]
      };
    });

    res.status(200).json({ metas });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};
