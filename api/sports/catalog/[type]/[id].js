const { getSportsChannels } = require('../../../../lib/sports');
const { posterFor } = require('../../../../lib/m3u');

function statusRank(status) {
  if (status === 'in') return 0;
  if (status === 'pre') return 1;
  return 2;
}

function sortByGame(a, b) {
  const aGame = a.game;
  const bGame = b.game;
  if (!aGame && !bGame) return a.name.localeCompare(b.name);
  if (!aGame) return 1;
  if (!bGame) return -1;

  const rankDiff = statusRank(aGame.status) - statusRank(bGame.status);
  if (rankDiff !== 0) return rankDiff;

  return new Date(aGame.startTime) - new Date(bGame.startTime);
}

function metaFor(ch) {
  const poster = posterFor(ch);
  let name = ch.name;
  let description = ch.group;

  if (ch.game) {
    const g = ch.game;
    name = `${g.awayTeam} @ ${g.homeTeam}`;
    if (g.status === 'in') {
      name += ` — ${g.awayScore}-${g.homeScore} (${g.statusDetail})`;
    } else if (g.status === 'pre') {
      const t = new Date(g.startTime);
      name += ` — ${t.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
    }
    description = `${g.awayTeam} @ ${g.homeTeam}\n${g.statusDetail || ''}`;
  }

  return {
    id: ch.id,
    type: 'tv',
    name,
    poster,
    posterShape: 'square',
    background: poster,
    genres: [ch.league || ch.group],
    description
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  try {
    const type = req.query.type;
    const id = (req.query.id || '').replace(/\.json$/, '');

    if (type !== 'tv') {
      return res.status(200).json({ metas: [] });
    }

    const channels = await getSportsChannels();

    let filtered;
    if (id === 'sports_live') {
      filtered = channels.filter((c) => c.game && c.game.status === 'in');
    } else if (id === 'sports_today') {
      filtered = channels.filter((c) => c.game);
    } else if (id === 'sports_unmatched') {
      filtered = channels.filter((c) => !c.game);
    } else if (id.startsWith('sports_league_')) {
      const league = id.slice('sports_league_'.length);
      filtered = channels.filter((c) => c.league === league);
    } else {
      return res.status(200).json({ metas: [] });
    }

    filtered = [...filtered].sort(sortByGame);

    res.status(200).json({ metas: filtered.map(metaFor) });
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
};
