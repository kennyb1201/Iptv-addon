const zlib = require('zlib');
const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
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

  res.status(200).json(status);
};
