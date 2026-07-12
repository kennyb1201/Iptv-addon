const zlib = require('zlib');
const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();

function renderHtml(status) {
  const dot = (ok) => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ok ? '#22c55e' : '#ef4444'};margin-right:8px;"></span>`;
  const row = (label, value) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2a2a3e;"><span style="color:#9ca3af;">${label}</span><span>${value}</span></div>`;

  const m3uRows = status.m3u.cached
    ? row('Last refreshed', `${status.m3u.ageMinutes} min ago`) +
      row('Channels', status.m3u.channelCount) +
      row('Total sources', status.m3u.sourceCount)
    : row('Status', status.m3u.error || 'Not cached yet');

  const epgRows = status.epg.cached
    ? row('Last refreshed', `${status.epg.ageMinutes} min ago`) +
      row('Window', `${status.epg.windowHours}h`) +
      row('Channels with EPG', status.epg.channelCount)
    : row('Status', status.epg.error || 'Not cached yet');

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nuvio IPTV — Status</title>
<style>
  body { background:#13131f; color:#e5e7eb; font-family:-apple-system,Roboto,sans-serif; margin:0; padding:20px; }
  h1 { font-size:20px; margin-bottom:20px; }
  .card { background:#1c1c2e; border-radius:12px; padding:16px; margin-bottom:16px; }
  .card h2 { font-size:15px; margin:0 0 10px 0; display:flex; align-items:center; }
  .refreshed { color:#6b7280; font-size:12px; margin-top:20px; text-align:center; }
</style>
</head>
<body>
  <h1>Nuvio IPTV — Status</h1>
  <div class="card">
    <h2>${dot(status.redis.reachable)}Redis</h2>
    ${row('Reachable', status.redis.reachable ? 'Yes' : (status.redis.error || 'No'))}
  </div>
  <div class="card">
    <h2>${dot(status.m3u.cached)}M3U Cache</h2>
    ${m3uRows}
  </div>
  <div class="card">
    <h2>${dot(status.epg.cached)}EPG Cache</h2>
    ${epgRows}
  </div>
  <div class="refreshed">Reload this page to check again</div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const status = {
    redis: { reachable: false },
    m3u: { cached: false },
    epg: { cached: false }
  };

  try {
    await redis.ping();
    status.redis.reachable = true;
  } catch (err) {
    status.redis.reachable = false;
    status.redis.error = err.message;
  }

  try {
    const compressed = await redis.get('m3u:channels');
    if (compressed) {
      const json = zlib.gunzipSync(Buffer.from(compressed, 'base64')).toString('utf8');
      const data = JSON.parse(json);
      const channels = data.channels || [];
      status.m3u = {
        cached: true,
        generatedAt: data.generatedAt,
        ageMinutes: Math.round((Date.now() - data.generatedAt) / 60000),
        channelCount: channels.length,
        sourceCount: channels.reduce((n, c) => n + (c.sources ? c.sources.length : 1), 0)
      };
    }
  } catch (err) {
    status.m3u = { cached: false, error: err.message };
  }

  try {
    const compressed = await redis.get('epg:data');
    if (compressed) {
      const json = zlib.gunzipSync(Buffer.from(compressed, 'base64')).toString('utf8');
      const data = JSON.parse(json);
      status.epg = {
        cached: true,
        generatedAt: data.generatedAt,
        ageMinutes: Math.round((Date.now() - data.generatedAt) / 60000),
        windowHours: data.windowHours,
        channelCount: Object.keys(data.channels || {}).length
      };
    }
  } catch (err) {
    status.epg = { cached: false, error: err.message };
  }

  const wantsHtml = (req.headers.accept || '').includes('text/html');
  if (wantsHtml) {
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(renderHtml(status));
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(status);
  }
};
