const { Redis } = require('@upstash/redis');

const redis = Redis.fromEnv();
const CACHE_KEY = 'm3u:channels';
const CACHE_TTL_SECONDS = 6 * 60 * 60;

let memCache = { data: null, ts: 0 };
const MEM_TTL_MS = 5 * 60 * 1000;

const PALETTE = ['1a1a2e', '2e1a3e', '1a2e2e', '3e2e1a', '2e1a1a', '1a2e3e'];

function hashToIndex(str, mod) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}

function posterFor(channel) {
  if (channel.logo) return channel.logo;
  const bg = PALETTE[hashToIndex(channel.name, PALETTE.length)];
  const text = encodeURIComponent(channel.name).slice(0, 80);
  return `https://placehold.co/400x400/${bg}/ffffff?font=roboto&text=${text}`;
}

function slugify(s) {
  return (s || '')
    .toString()
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  const seenIds = new Set();
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#EXTINF')) {
      const attrs = {};
      const attrRegex = /([a-zA-Z0-9-]+)="([^"]*)"/g;
      let m;
      while ((m = attrRegex.exec(line)) !== null) {
        attrs[m[1].toLowerCase()] = m[2];
      }
      const nameMatch = line.match(/,(.*)$/);
      const name = (nameMatch ? nameMatch[1].trim() : '') || attrs['tvg-name'] || 'Unknown Channel';

      current = {
        tvgId: attrs['tvg-id'] || '',
        tvgName: attrs['tvg-name'] || name,
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || 'General',
        name,
        userAgent: ''
      };
    } else if (line.startsWith('#EXTVLCOPT') && current) {
      const m = line.match(/http-user-agent\s*=\s*(.+)$/i);
      if (m) current.userAgent = m[1].trim();
    } else if (line && !line.startsWith('#') && current) {
      current.url = line;

      const idBase = current.tvgId || current.tvgName || current.name;
      let id = 'iptv_' + slugify(idBase);
      let suffix = 2;
      let finalId = id;
      while (seenIds.has(finalId)) {
        finalId = `${id}_${suffix++}`;
      }
      seenIds.add(finalId);
      current.id = finalId;

      channels.push(current);
      current = null;
    }
  }
  return channels;
}

async function fetchAndParse() {
  const url = process.env.M3U_URL;
  if (!url) {
    throw new Error('M3U_URL environment variable is not set');
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch M3U playlist: HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseM3U(text);
}

async function isUrlAlive(url, userAgent, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = userAgent ? { 'User-Agent': userAgent } : {};
  try {
    const headRes = await fetch(url, { method: 'HEAD', signal: controller.signal, headers });
    if (headRes.ok) return true;
    if (headRes.status !== 405) return false;

    const getRes = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { ...headers, Range: 'bytes=0-1024' }
    });
    return getRes.ok || getRes.status === 206;
  } catch (err) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function pruneDeadChannels(channels, opts = {}) {
  const timeBudgetMs = opts.timeBudgetMs || 45000;
  const concurrency = opts.concurrency || 15;
  const perRequestTimeoutMs = opts.perRequestTimeoutMs || 4000;

  const start = Date.now();
  const keep = new Array(channels.length).fill(true);
  let index = 0;

  async function worker() {
    while (index < channels.length) {
      if (Date.now() - start > timeBudgetMs) break;
      const i = index++;
      const ch = channels[i];
      keep[i] = await isUrlAlive(ch.url, ch.userAgent, perRequestTimeoutMs);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, channels.length) }, worker);
  await Promise.all(workers);

  return channels.filter((_, i) => keep[i]);
}

async function getChannels() {
  const now = Date.now();
  if (memCache.data && now - memCache.ts < MEM_TTL_MS) {
    return memCache.data;
  }

  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached && cached.channels) {
      memCache = { data: cached.channels, ts: now };
      return cached.channels;
    }
  } catch (err) {
    // Redis unavailable — fall through to a direct fetch below
  }

  const channels = await fetchAndParse();
  memCache = { data: channels, ts: now };
  return channels;
}

async function refreshM3uCache(opts = {}) {
  const validate = opts.validate !== false;
  const channels = await fetchAndParse();

  const finalChannels = validate ? await pruneDeadChannels(channels) : channels;

  await redis.set(CACHE_KEY, { channels: finalChannels, generatedAt: Date.now() }, { ex: CACHE_TTL_SECONDS });
  memCache = { data: finalChannels, ts: Date.now() };

  return {
    total: channels.length,
    kept: finalChannels.length,
    removed: channels.length - finalChannels.length,
    validated: validate
  };
}

module.exports = { getChannels, refreshM3uCache, parseM3U, slugify, posterFor };
