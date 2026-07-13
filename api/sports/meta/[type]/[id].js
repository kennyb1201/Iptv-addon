const { getSportsChannels } = require('../../../../lib/sports');
const { posterFor } = require('../../../../lib/m3u');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  try {
    const type = req.query.type;
    const id = (req.query.id || '').replace(/\.json$/, '');

    if (type !== 'tv') {
      return res.status(200).json({ meta: null });
    }

    const channels = await getSportsChannels();
    const ch = channels.find((c) => c.id === id);
    if (!ch) {
      return res.status(200).json({ meta: null });
    }

    const poster = ch.game ? `https://${req.headers.host}/sports/poster/${ch.id}.png` : posterFor(ch);
    let name = ch.name;
    let description = ch.group;

    if (ch.game) {
      const g = ch.game;
      name = `${g.awayTeam} @ ${g.homeTeam}`;
      description = `${g.awayTeam} @ ${g.homeTeam}\n${g.statusDetail || ''}`;
      if (g.status === 'in') {
        description += `\nScore: ${g.awayTeam} ${g.awayScore} - ${g.homeScore} ${g.homeTeam}`;
      } else if (g.status === 'pre') {
        const t = new Date(g.startTime);
        description += `\nStarts: ${t.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`;
      }
    }

    res.status(200).json({
      meta: {
        id: ch.id,
        type: 'tv',
        name,
        poster,
        posterShape: 'square',
        background: poster,
        genres: [ch.league || ch.group],
        description
      }
    });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};
