const { getChannels, slugify } = require('../lib/m3u');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const catalogs = [
    {
      type: 'tv',
      id: 'iptv_channels',
      name: 'All Channels',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'tv',
      id: 'iptv_search',
      name: 'Search All Channels',
      extra: [
        { name: 'search', isRequired: true },
        { name: 'skip', isRequired: false }
      ]
    }
  ];

  try {
    const channels = await getChannels();
    const groups = [...new Set(channels.map((c) => c.group))].sort();
    for (const group of groups) {
      catalogs.push({
        type: 'tv',
        id: 'iptv_genre_' + slugify(group),
        name: group,
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false }
        ]
      });
    }
  } catch (err) {
    // fall back to just the base catalogs if the M3U/cache read fails here
  }

  res.status(200).json({
    id: 'org.kennyb1201.iptv',
    version: '1.1.0',
    name: 'Nuvio IPTV',
    description: 'Live IPTV channels from personal M3U playlist',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs,
    idPrefixes: ['iptv_'],
    behaviorHints: { configurable: false }
  });
};
