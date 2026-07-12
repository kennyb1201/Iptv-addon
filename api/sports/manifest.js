const { getSportsChannels, LEAGUE_LABELS } = require('../../lib/sports');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const catalogs = [
    { type: 'tv', id: 'sports_live', name: 'Live Now', extra: [] },
    { type: 'tv', id: 'sports_today', name: "Today's Games", extra: [] }
  ];

  try {
    const channels = await getSportsChannels();
    const leaguesPresent = [...new Set(channels.filter((c) => c.league).map((c) => c.league))];

    for (const league of leaguesPresent) {
      catalogs.push({
        type: 'tv',
        id: 'sports_league_' + league,
        name: LEAGUE_LABELS[league] || league,
        extra: []
      });
    }

    const unmatchedCount = channels.filter((c) => !c.game).length;
    if (unmatchedCount > 0) {
      catalogs.push({
        type: 'tv',
        id: 'sports_unmatched',
        name: `Other Sports/PPV (${unmatchedCount})`,
        extra: []
      });
    }
  } catch (err) {
    // fall back to just Live/Today if the M3U or ESPN fetch fails here
  }

  res.status(200).json({
    id: 'org.kennyb1201.sports',
    version: '1.0.0',
    name: 'Nuvio Sports',
    description: 'Live sports channels from your M3U, matched to real game schedules',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs,
    idPrefixes: ['iptv_'],
    behaviorHints: { configurable: false }
  });
};
