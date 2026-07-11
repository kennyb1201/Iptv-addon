const zlib = require('zlib');
const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();
const KV_KEY = 'epg:data';
const WINDOW_HOURS = 8;
const MAX_UPCOMING_PER_CHANNEL = 8;

function parseXmltvDate(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*(?:([+-])(\d{2})(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, sign, offHH, offMM] = m;
  const asIfUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  let offsetMinutes = 0;
  if (sign) {
    offsetMinutes = (parseInt(offHH, 10) * 60 + parseInt(offMM, 10)) * (sign === '-' ? -1 : 1);
  }
  return asIfUtc - offsetMinutes * 60 * 1000;
}

function extractAttr(tag, name) {
  const m = tag.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
}

function extractText(block, tagName) {
  const m = block.match(new RegExp(`<${tagName}[^>]*>([^<]*)<\\/${tagName}>`));
  return m ? m[1].trim() : null;
}

function parseEpgData(xmlText, nowMs, windowHours = WINDOW_HOURS) {
  const windowMs = windowHours * 60 * 60 * 1000;
  const raw = {};
  const programmeRegex = /<programme\b[^>]*>[\s\S]*?<\/programme>/g;
  let match;

  while ((match = programmeRegex.exec(xmlText)) !== null) {
    const block = match[0];
    const openTagEnd = block.indexOf('>');
    const openTag = block.slice(0, openTagEnd);

    const channel = extractAttr(openTag, 'channel');
    if (!channel) continue;

    const startMs = parseXmltvDate(extractAttr(openTag, 'start'));
    const stopMs = parseXmltvDate(extractAttr(openTag, 'stop'));
    if (startMs === null || stopMs === null) continue;

    if (stopMs <= nowMs || startMs >= nowMs + windowMs) continue;

    const title = extractText(block, 'title') || 'Unknown';

    if (!raw[channel]) raw[channel] = [];
    raw[channel].push({ title, start: startMs, stop: stopMs });
  }

  const channels = {};
  for (const [tvgId, programmes] of Object.entries(raw)) {
    programmes.sort((a, b) => a.start - b.start);
    const current = programmes.find((p) => p.start <= nowMs && nowMs < p.stop) || null;
    const next = programmes.find((p) => p.start > nowMs) || null;
    channels[tvgId] = { current, next, upcoming: programmes.slice(0, MAX_UPCOMING_PER_CHANNEL) };
  }

  return channels;
}

async function refreshEpg() {
  const url = process.env.EPG_URL;
  if (!url) throw new Error('EPG_URL environment variable is not set');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch EPG: HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const isGzip = url.endsWith('.gz');
  const xml = isGzip ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');

  const nowMs = Date.now();
  const channels = parseEpgData(xml, nowMs, WINDOW_HOURS);

  const payload = { generatedAt: nowMs, windowHours: WINDOW_HOURS, channels };

  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64');
  await redis.set(KV_KEY, compressed);

  return { channelCount: Object.keys(channels).length, generatedAt: nowMs };
}

async function getEpgData() {
  try {
    const compressed = await redis.get(KV_KEY);
    if (!compressed) return null;
    const json = zlib.gunzipSync(Buffer.from(compressed, 'base64')).toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

module.exports = { refreshEpg, getEpgData, parseEpgData, parseXmltvDate };
