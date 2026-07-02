module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.status(200).json({
    id: 'org.kennyb1201.iptv',
    version: '1.0.0',
    name: 'Nuvio IPTV',
    description: 'Live IPTV channels from personal M3U playlist',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs: [
      {
        type: 'tv',
        id: 'iptv_channels',
        name: 'IPTV Channels',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'genre', isRequired: false }
        ]
      }
    ],
    idPrefixes: ['iptv_'],
    behaviorHints: { configurable: false }
  });
};
