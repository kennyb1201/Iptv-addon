const zlib = require('zlib');
const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();
const KV_KEY = 'epg:now_next';

// XMLTV dates look like "20260702130000 +0000"
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

function parseEpgNowNext(xmlText, nowMs) {
  const result = {};
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

    const title = extractText(block, 'title') || 'Unknown';

    if (!result[channel]) result[channel] = { current: null, next: null };
    const entry = result[channel];

    if (startMs <= nowMs && nowMs < stopMs) {
      entry.current = { title, start: startMs, stop: stopMs };
    } else if (startMs > nowMs) {
      if (!entry.next || startMs < entry.next.start) {
        entry.next = { title, start: startMs, stop: stopMs };
      }
    }
  }

  return result;
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
  const channels = parseEpgNowNext(xml, nowMs);

  const payload = { generatedAt: nowMs, channels };
  await redis.set(KV_KEY, payload);

  return { channelCount: Object.keys(channels).length, generatedAt: nowMs };
}

async function getEpgData() {
  try {
    const data = await redis.get(KV_KEY);
    return data || null;
  } catch (err) {
    return null;
  }
}

module.exports = { refreshEpg, getEpgData, parseEpgNowNext, parseXmltvDate };
